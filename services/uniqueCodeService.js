/**
 * Service: Pengelolaan Kode Unik Transaksi & QRIS Terpadu
 * 
 * Menangani:
 * 1. Pengecekan ketersediaan nominal unik lintas tabel (Invoices, Voucher Orders, Topup Requests, Donation Orders).
 * 2. Alokasi kode unik acak terdistribusi (randomized allocation) untuk penjualan voucher online ber-nominal sama
 *    agar pembeli dengan paket yang sama tidak mengalami bentrokan (collision) atau race condition.
 * 3. Alokasi kode unik berbasis ID Pelanggan (preferred code) untuk invoice bulanan dan topup saldo.
 * 4. Pembersihan otomatis (cleanup / auto-expire) pesanan pending yang sudah lewat batas waktu (stale orders)
 *    sehingga kode unik dapat didaur ulang (recycle).
 */

const db = require('../config/database');
const { logger } = require('../config/logger');

// Durasi kadaluarsa default (dalam milidetik)
const VOUCHER_ORDER_EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 Jam untuk pesanan voucher
const TOPUP_ORDER_EXPIRY_MS = 2 * 60 * 60 * 1000;   // 2 Jam untuk pesanan topup

/**
 * Format tanggal lokal YYYY-MM-DD HH:mm:ss
 */
function formatLocalTimestamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Auto-expire pesanan voucher dan topup yang sudah kadaluarsa
 */
function cleanupExpiredPendingOrders() {
  let expiredVouchers = 0;
  let expiredTopups = 0;

  const nowIso = new Date().toISOString();
  const twoHoursAgo = new Date(Date.now() - VOUCHER_ORDER_EXPIRY_MS);
  const twoHoursAgoLocal = formatLocalTimestamp(twoHoursAgo);

  try {
    const vRes = db.prepare(`
      UPDATE public_voucher_orders
      SET status = 'expired', updated_at = (NOW_LOCAL())
      WHERE status = 'pending'
        AND (
          (payment_expires_at IS NOT NULL AND payment_expires_at != '' AND payment_expires_at < ?)
          OR (created_at < datetime('now', '-2 hours'))
        )
    `).run(nowIso);
    expiredVouchers = Number(vRes?.changes || 0);
  } catch (e) {
    logger.error(`[uniqueCodeService] Cleanup expired vouchers error: ${e?.message || e}`);
  }

  try {
    const tRes = db.prepare(`
      UPDATE customer_topup_requests
      SET status = 'expired', updated_at = (NOW_LOCAL())
      WHERE status = 'pending'
        AND (
          (payment_expires_at IS NOT NULL AND payment_expires_at != '' AND payment_expires_at < ?)
          OR (created_at < datetime('now', '-2 hours'))
        )
    `).run(nowIso);
    expiredTopups = Number(tRes?.changes || 0);
  } catch (e) {
    logger.error(`[uniqueCodeService] Cleanup expired topups error: ${e?.message || e}`);
  }

  if (expiredVouchers > 0 || expiredTopups > 0) {
    logger.info(`[uniqueCodeService] Expired stale orders: ${expiredVouchers} vouchers, ${expiredTopups} topups released.`);
  }

  return { expiredVouchers, expiredTopups };
}

/**
 * Cek apakah sebuah nominal unik (amount) bebas dari bentrokan di seluruh tabel
 */
function isQrisAmountAvailable(amount, opts = {}) {
  const amt = Number(amount || 0);
  if (!Number.isFinite(amt) || amt <= 0) return false;

  const excludeInvoiceId = Number(opts.excludeInvoiceId || 0);
  const excludeVoucherOrderId = Number(opts.excludeVoucherOrderId || 0);
  const excludeTopupId = Number(opts.excludeTopupId || 0);
  const excludeDonationOrderId = Number(opts.excludeDonationOrderId || 0);

  // 1. Cek Invoices (unpaid)
  const inv = db.prepare('SELECT id FROM invoices WHERE status = ? AND qris_amount_unique = ? AND id != ? LIMIT 1')
    .get('unpaid', amt, excludeInvoiceId);
  if (inv && inv.id) return false;

  // 2. Cek Public Voucher Orders (pending)
  const ord = db.prepare('SELECT id FROM public_voucher_orders WHERE status = ? AND qris_amount_unique = ? AND id != ? LIMIT 1')
    .get('pending', amt, excludeVoucherOrderId);
  if (ord && ord.id) return false;

  // 3. Cek Customer Topup Requests (pending)
  try {
    const topup = db.prepare('SELECT id FROM customer_topup_requests WHERE status = ? AND qris_amount_unique = ? AND id != ? LIMIT 1')
      .get('pending', amt, excludeTopupId);
    if (topup && topup.id) return false;
  } catch (_) {}

  // 4. Cek Public Donation Orders (pending)
  try {
    const don = db.prepare('SELECT id FROM public_donation_orders WHERE status = ? AND qris_amount_unique = ? AND id != ? LIMIT 1')
      .get('pending', amt, excludeDonationOrderId);
    if (don && don.id) return false;
  } catch (_) {}

  return true;
}

/**
 * Alokasi kode unik acak/terpilih untuk baseAmount
 */
function allocateUniqueCode(baseAmount, opts = {}) {
  const baseAmt = Math.floor(Number(baseAmount || 0));
  if (!Number.isFinite(baseAmt) || baseAmt <= 0) {
    throw new Error('Nominal dasar tidak valid untuk alokasi kode unik.');
  }

  // Bersihkan order kadaluarsa terlebih dahulu agar slot kosong kembali terbuka
  cleanupExpiredPendingOrders();

  const excludeInvoiceId = Number(opts.excludeInvoiceId || 0);
  const excludeVoucherOrderId = Number(opts.excludeVoucherOrderId || 0);
  const excludeTopupId = Number(opts.excludeTopupId || 0);
  const excludeDonationOrderId = Number(opts.excludeDonationOrderId || 0);

  // Ambil semua amount unik aktif yang berada dalam rentang [baseAmt + 1, baseAmt + 999]
  const minAmt = baseAmt + 1;
  const maxAmt = baseAmt + 999;
  const occupiedAmounts = new Set();

  try {
    const invRows = db.prepare('SELECT qris_amount_unique FROM invoices WHERE status = ? AND qris_amount_unique BETWEEN ? AND ? AND id != ?')
      .all('unpaid', minAmt, maxAmt, excludeInvoiceId);
    for (const r of invRows) if (r.qris_amount_unique) occupiedAmounts.add(Number(r.qris_amount_unique));
  } catch (_) {}

  try {
    const vRows = db.prepare('SELECT qris_amount_unique FROM public_voucher_orders WHERE status = ? AND qris_amount_unique BETWEEN ? AND ? AND id != ?')
      .all('pending', minAmt, maxAmt, excludeVoucherOrderId);
    for (const r of vRows) if (r.qris_amount_unique) occupiedAmounts.add(Number(r.qris_amount_unique));
  } catch (_) {}

  try {
    const tRows = db.prepare('SELECT qris_amount_unique FROM customer_topup_requests WHERE status = ? AND qris_amount_unique BETWEEN ? AND ? AND id != ?')
      .all('pending', minAmt, maxAmt, excludeTopupId);
    for (const r of tRows) if (r.qris_amount_unique) occupiedAmounts.add(Number(r.qris_amount_unique));
  } catch (_) {}

  try {
    const dRows = db.prepare('SELECT qris_amount_unique FROM public_donation_orders WHERE status = ? AND qris_amount_unique BETWEEN ? AND ? AND id != ?')
      .all('pending', minAmt, maxAmt, excludeDonationOrderId);
    for (const r of dRows) if (r.qris_amount_unique) occupiedAmounts.add(Number(r.qris_amount_unique));
  } catch (_) {}

  // 1. Cek preferredCode terlebih dahulu (jika ada)
  const prefCode = Number(opts.preferredCode || 0);
  if (prefCode >= 1 && prefCode <= 999) {
    const prefAmt = baseAmt + prefCode;
    if (!occupiedAmounts.has(prefAmt) && isQrisAmountAvailable(prefAmt, opts)) {
      return { uniqueCode: prefCode, amountUnique: prefAmt };
    }
  }

  // 2. Kumpulkan slot kosong di range utama 1 s/d 499
  const freeCodesPrimary = [];
  for (let c = 1; c <= 499; c++) {
    const testAmt = baseAmt + c;
    if (!occupiedAmounts.has(testAmt)) {
      freeCodesPrimary.push(c);
    }
  }

  const shouldRandomize = opts.randomize !== false; // default true

  if (freeCodesPrimary.length > 0) {
    if (shouldRandomize) {
      const shuffled = [...freeCodesPrimary];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      for (const code of shuffled) {
        const testAmt = baseAmt + code;
        if (isQrisAmountAvailable(testAmt, opts)) {
          return { uniqueCode: code, amountUnique: testAmt };
        }
      }
    } else {
      for (const code of freeCodesPrimary) {
        const testAmt = baseAmt + code;
        if (isQrisAmountAvailable(testAmt, opts)) {
          return { uniqueCode: code, amountUnique: testAmt };
        }
      }
    }
  }

  // 3. Fallback range 500 s/d 999 jika 1..499 penuh
  const freeCodesFallback = [];
  for (let c = 500; c <= 999; c++) {
    const testAmt = baseAmt + c;
    if (!occupiedAmounts.has(testAmt)) {
      freeCodesFallback.push(c);
    }
  }

  if (freeCodesFallback.length > 0) {
    if (shouldRandomize) {
      const shuffled = [...freeCodesFallback];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      for (const code of shuffled) {
        const testAmt = baseAmt + code;
        if (isQrisAmountAvailable(testAmt, opts)) {
          return { uniqueCode: code, amountUnique: testAmt };
        }
      }
    } else {
      for (const code of freeCodesFallback) {
        const testAmt = baseAmt + code;
        if (isQrisAmountAvailable(testAmt, opts)) {
          return { uniqueCode: code, amountUnique: testAmt };
        }
      }
    }
  }

  throw new Error('Gagal membuat nominal unik (slot kode 1-999 untuk nominal ini sedang penuh).');
}

/**
 * Pastikan pesanan voucher memiliki QRIS amount unik
 */
function ensureVoucherOrderQrisUnique(order, force = false) {
  const orderId = Number(order?.id || 0);
  if (!Number.isFinite(orderId) || orderId <= 0) throw new Error('Order ID tidak valid');
  if (String(order?.status) !== 'pending') throw new Error('Hanya pesanan PENDING yang bisa dibuat kode QRIS.');

  const baseAmount = Number(order?.price || 0);
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) throw new Error('Harga voucher tidak valid');

  const currentAmount = Number(order?.qris_amount_unique || 0) || 0;
  const currentCode = Number(order?.qris_unique_code || 0) || 0;
  if (!force && currentAmount > 0 && currentCode > 0 && (currentAmount - currentCode === baseAmount)) {
    return { uniqueCode: currentCode, amountUnique: currentAmount };
  }

  const { uniqueCode, amountUnique } = allocateUniqueCode(baseAmount, {
    randomize: true,
    excludeVoucherOrderId: orderId
  });

  db.prepare(`
    UPDATE public_voucher_orders
    SET qris_unique_code = ?,
        qris_amount_unique = ?,
        qris_assigned_at = COALESCE(qris_assigned_at, (NOW_LOCAL())),
        updated_at = (NOW_LOCAL())
    WHERE id = ?
  `).run(uniqueCode, amountUnique, orderId);

  return { uniqueCode, amountUnique };
}

/**
 * Pastikan invoice memiliki QRIS amount unik
 */
function ensureInvoiceQrisUnique(inv, force = false) {
  const invId = Number(inv?.id || 0);
  if (!Number.isFinite(invId) || invId <= 0) throw new Error('Invoice ID tidak valid');
  if (String(inv?.status) !== 'unpaid') throw new Error('Hanya tagihan BELUM BAYAR yang bisa dibuat kode QRIS.');

  const custId = Number(inv?.customer_id || 0);
  let baseAmount = Number(inv?.amount || 0);

  if (custId > 0) {
    const unpaidInvoices = db.prepare("SELECT amount FROM invoices WHERE customer_id = ? AND status = 'unpaid'").all(custId);
    if (unpaidInvoices && unpaidInvoices.length > 0) {
      const sumAll = unpaidInvoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
      if (sumAll > 0) baseAmount = sumAll;
    }
  }

  if (!Number.isFinite(baseAmount) || baseAmount <= 0) throw new Error('Nominal tagihan tidak valid');

  const currentAmount = Number(inv?.qris_amount_unique || 0) || 0;
  const currentCode = Number(inv?.qris_unique_code || 0) || 0;
  if (!force && currentAmount > 0 && currentCode > 0 && (currentAmount - currentCode === baseAmount)) {
    return { uniqueCode: currentCode, amountUnique: currentAmount };
  }

  const prefCode = (custId > 0) ? ((custId % 499 === 0) ? 499 : (custId % 499)) : null;
  const { uniqueCode, amountUnique } = allocateUniqueCode(baseAmount, {
    preferredCode: prefCode,
    randomize: false,
    excludeInvoiceId: invId
  });

  db.prepare(`
    UPDATE invoices
    SET qris_unique_code = ?,
        qris_amount_unique = ?,
        qris_assigned_at = (NOW_LOCAL())
    WHERE id = ?
  `).run(uniqueCode, amountUnique, invId);

  return { uniqueCode, amountUnique };
}

/**
 * Pastikan topup memiliki QRIS amount unik
 */
function ensureTopupQrisUnique(topup, force = false) {
  const topupId = Number(topup?.id || 0);
  if (!Number.isFinite(topupId) || topupId <= 0) throw new Error('Top-up ID tidak valid');
  if (String(topup?.status) !== 'pending') throw new Error('Hanya top-up status pending yang bisa dibuat kode QRIS.');

  const custId = Number(topup?.customer_id || 0);
  const baseAmount = Number(topup?.amount || 0);
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) throw new Error('Nominal top-up tidak valid');

  const currentAmount = Number(topup?.qris_amount_unique || 0) || 0;
  const currentCode = Number(topup?.qris_unique_code || 0) || 0;
  if (!force && currentAmount > 0 && currentCode > 0 && (currentAmount - currentCode === baseAmount)) {
    return { uniqueCode: currentCode, amountUnique: currentAmount };
  }

  const prefCode = (custId > 0) ? ((custId % 499 === 0) ? 499 : (custId % 499)) : null;
  const { uniqueCode, amountUnique } = allocateUniqueCode(baseAmount, {
    preferredCode: prefCode,
    randomize: false,
    excludeTopupId: topupId
  });

  db.prepare(`
    UPDATE customer_topup_requests
    SET qris_unique_code = ?,
        qris_amount_unique = ?,
        qris_assigned_at = (NOW_LOCAL()),
        updated_at = (NOW_LOCAL())
    WHERE id = ?
  `).run(uniqueCode, amountUnique, topupId);

  return { uniqueCode, amountUnique };
}

module.exports = {
  cleanupExpiredPendingOrders,
  isQrisAmountAvailable,
  allocateUniqueCode,
  ensureVoucherOrderQrisUnique,
  ensureInvoiceQrisUnique,
  ensureTopupQrisUnique,
  VOUCHER_ORDER_EXPIRY_MS,
  TOPUP_ORDER_EXPIRY_MS
};
