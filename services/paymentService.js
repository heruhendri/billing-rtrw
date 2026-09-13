/**
 * Service: Integrasi Payment Gateway (Multi-Gateway)
 * Diadaptasi dari alur gembok-simple
 */
const axios = require('axios');
const crypto = require('crypto');
const { getSettingsWithCache } = require('../config/settingsManager');
const { logger } = require('../config/logger');

/**
 * Helper: Format pesan error dari response API Gateway agar tampil manusiawi & cantik
 */
function formatGatewayError(gatewayName, error) {
  const respData = error.response ? error.response.data : null;
  let cleanMsg = '';

  if (respData) {
    if (typeof respData === 'string') {
      cleanMsg = respData;
    } else if (Array.isArray(respData.error_messages) && respData.error_messages.length > 0) {
      cleanMsg = respData.error_messages.join(', ');
    } else if (respData.message) {
      cleanMsg = respData.message;
    } else if (respData.statusMessage) {
      cleanMsg = respData.statusMessage;
    } else if (respData.error_code) {
      cleanMsg = respData.error_code;
    } else {
      try {
        cleanMsg = JSON.stringify(respData);
      } catch (e) {
        cleanMsg = String(respData);
      }
    }
  } else {
    cleanMsg = error.message || String(error || 'Terjadi kesalahan pada Payment Gateway');
  }

  logger.error(`[${gatewayName}] Error: ${cleanMsg}`);
  return new Error(`${gatewayName}: ${cleanMsg}`);
}

/**
 * Generate fallback email based on phone number
 */
function getFallbackEmail(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return `cust${digits || '08977345640'}@hendri.net`;
}

/**
 * Normalize phone number for Payment Gateway
 */
function normalizePhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0')) {
    digits = '62' + digits.slice(1);
  } else if (!digits.startsWith('62')) {
    digits = '62' + digits;
  }
  return digits;
}

/**
 * Tripay: Membuat Transaksi
 */
async function createTripayTransaction(invoice, customer, method = 'QRIS', appUrl = '', opts = {}) {
  const settings = getSettingsWithCache();
  const apiKey = settings.tripay_api_key;
  const privateKey = settings.tripay_private_key;
  const merchantCode = settings.tripay_merchant_code;
  const isLive = settings.tripay_mode === 'live' || settings.tripay_mode === 'production';
  
  if (!apiKey || !privateKey || !merchantCode) {
    throw new Error('Tripay Error: Pengaturan API Key, Private Key, atau Merchant Code belum diisi.');
  }

  const baseUrl = isLive 
    ? 'https://tripay.co.id/api/transaction/create' 
    : 'https://tripay.co.id/api-sandbox/transaction/create';

  const prefix = String(opts.orderPrefix || 'INV').toUpperCase();
  const merchantRef = `${prefix}-${invoice.id}-${Date.now()}`;
  const amount = Number(invoice.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Tripay Error: Nominal tagihan tidak valid');
  }

  const signature = crypto.createHmac('sha256', privateKey)
    .update(merchantCode + merchantRef + amount)
    .digest('hex');

  const finalAppUrl = appUrl || settings.app_url || '';
  const phone = normalizePhone(customer.phone || '0');
  const email = customer.email || getFallbackEmail(phone);
  const itemName =
    String(opts.itemName || invoice.item_name || '').trim() ||
    (invoice.period_month && invoice.period_year
      ? `Tagihan Internet Periode ${invoice.period_month}/${invoice.period_year}`
      : `Pembayaran #${invoice.id}`);
  const sku = String(opts.sku || invoice.sku || `ITEM-${invoice.id}`).trim() || `ITEM-${invoice.id}`;
  const callbackPath = String(opts.callbackPath || '/customer/payment/callback');
  const returnPath = String(opts.returnPath || '/customer/dashboard');

  const payload = {
    method: method,
    merchant_ref: merchantRef,
    amount: amount,
    customer_name: customer.name || 'Pelanggan',
    customer_email: email,
    customer_phone: phone,
    order_items: [
      {
        sku: sku,
        name: itemName,
        price: amount,
        quantity: 1
      }
    ],
    signature: signature,
    callback_url: finalAppUrl ? `${finalAppUrl}${callbackPath}` : undefined,
    return_url: finalAppUrl ? `${finalAppUrl}${returnPath}` : undefined
  };

  try {
    const res = await axios.post(baseUrl, payload, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    
    if (res.data && res.data.success) {
      return {
        success: true,
        link: res.data.data.checkout_url,
        reference: res.data.data.reference,
        order_id: merchantRef,
        payload: res.data.data
      };
    }
    throw new Error(res.data.message || 'Gagal membuat transaksi di Tripay');
  } catch (error) {
    throw formatGatewayError('Tripay', error);
  }
}

/**
 * Midtrans: Membuat Transaksi (Snap)
 */
async function createMidtransTransaction(invoice, customer, method = 'snap', appUrl = '', opts = {}) {
  const settings = getSettingsWithCache();
  const serverKey = settings.midtrans_server_key;
  const isLive = settings.midtrans_mode === 'live' || settings.midtrans_mode === 'production';
  
  if (!serverKey) {
    throw new Error('Midtrans Error: Server Key belum diatur di pengaturan.');
  }

  const baseUrl = isLive
    ? 'https://app.midtrans.com/snap/v1/transactions'
    : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

  const prefix = String(opts.orderPrefix || 'INV').toUpperCase();
  const orderId = `${prefix}-${invoice.id}-${Date.now()}`;
  const finalAppUrl = appUrl || settings.app_url || '';
  const phone = normalizePhone(customer.phone || '0');
  const email = customer.email || getFallbackEmail(phone);
  const itemName =
    String(opts.itemName || invoice.item_name || '').trim() ||
    (invoice.period_month && invoice.period_year
      ? `Tagihan Internet ${invoice.period_month}/${invoice.period_year}`
      : `Pembayaran #${invoice.id}`);
  const sku = String(opts.sku || invoice.sku || `ITEM-${invoice.id}`).trim() || `ITEM-${invoice.id}`;
  const returnPath = String(opts.returnPath || '/customer/dashboard');
  
  const payload = {
    transaction_details: {
      order_id: orderId,
      gross_amount: invoice.amount
    },
    customer_details: {
      first_name: customer.name,
      email: email,
      phone: phone
    },
    item_details: [{
      id: sku,
      price: invoice.amount,
      quantity: 1,
      name: itemName
    }]
  };

  // Jika method bukan 'snap', kita batasi pembayarannya
  if (method !== 'snap') {
    const methodMap = {
      'QRIS': ['gopay', 'qris'],
      'MANDIRIVA': ['echannel'],
      'BRIVA': ['bri_va'],
      'BNIVA': ['bni_va'],
      'BCAVA': ['bca_va'],
      'PERMATAVA': ['permata_va']
    };
    if (methodMap[method]) {
      payload.enabled_payments = methodMap[method];
    }
  }

  if (finalAppUrl) {
    payload.callbacks = {
      finish: `${finalAppUrl}${returnPath}`,
      error: `${finalAppUrl}${returnPath}`,
      pending: `${finalAppUrl}${returnPath}`
    };
  }

  const auth = Buffer.from(serverKey + ':').toString('base64');

  try {
    const res = await axios.post(baseUrl, payload, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`
      }
    });

    return {
      success: true,
      link: res.data.redirect_url,
      reference: res.data.token,
      order_id: orderId,
      payload: res.data
    };
  } catch (error) {
    throw formatGatewayError('Midtrans', error);
  }
}

/**
 * Xendit: Membuat Invoice (Checkout Link)
 */
async function createXenditTransaction(invoice, customer, method = 'xendit', appUrl = '', opts = {}) {
  const settings = getSettingsWithCache();
  const apiKey = settings.xendit_api_key;
  
  if (!apiKey) {
    throw new Error('Xendit Error: API Key belum diatur di pengaturan.');
  }

  const prefix = String(opts.orderPrefix || 'INV').toUpperCase();
  const orderId = `${prefix}-${invoice.id}-${Date.now()}`;
  const finalAppUrl = appUrl || settings.app_url || '';
  const phone = normalizePhone(customer.phone || '0');
  const email = customer.email || getFallbackEmail(phone);
  const itemName =
    String(opts.itemName || invoice.item_name || '').trim() ||
    (invoice.period_month && invoice.period_year
      ? `Internet ${invoice.period_month}/${invoice.period_year}`
      : `Pembayaran #${invoice.id}`);
  const description =
    String(opts.description || invoice.description || '').trim() ||
    (invoice.period_month && invoice.period_year
      ? `Tagihan Internet Periode ${invoice.period_month}/${invoice.period_year}`
      : itemName);
  const returnPath = String(opts.returnPath || '/customer/dashboard');

  const payload = {
    external_id: orderId,
    amount: invoice.amount,
    description: description,
    invoice_duration: 86400, // 24 jam
    customer: {
      given_names: customer.name,
      email: email,
      mobile_number: phone
    },
    success_redirect_url: `${finalAppUrl}${returnPath}`,
    failure_redirect_url: `${finalAppUrl}${returnPath}`,
    currency: 'IDR',
    items: [{
      name: itemName,
      quantity: 1,
      price: invoice.amount
    }]
  };

  // Jika user memilih metode spesifik di Xendit
  if (method !== 'xendit') {
    const methodMap = {
      'QRIS': ['QRIS'],
      'MANDIRIVA': ['MANDIRI'],
      'BRIVA': ['BRI'],
      'BNIVA': ['BNI'],
      'BCAVA': ['BCA'],
      'PERMATAVA': ['PERMATA']
    };
    if (methodMap[method]) {
      payload.payment_methods = methodMap[method];
    }
  }

  const auth = Buffer.from(apiKey + ':').toString('base64');

  try {
    const res = await axios.post('https://api.xendit.co/v2/invoices', payload, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });

    return {
      success: true,
      link: res.data.invoice_url,
      reference: res.data.id,
      order_id: orderId,
      payload: res.data
    };
  } catch (error) {
    throw formatGatewayError('Xendit', error);
  }
}

/**
 * Duitku: Membuat Transaksi (Checkout Link via Inquiry)
 */
async function createDuitkuTransaction(invoice, customer, method = 'duitku', appUrl = '', opts = {}) {
  const settings = getSettingsWithCache();
  const merchantCode = settings.duitku_merchant_code;
  const apiKey = settings.duitku_api_key;
  const isLive = settings.duitku_mode === 'live' || settings.duitku_mode === 'production';
  
  if (!merchantCode || !apiKey) {
    throw new Error('Duitku Error: Merchant Code atau API Key belum diatur.');
  }

  const baseUrl = isLive 
    ? 'https://passport.duitku.com/webapi/api/merchant/v2/inquiry'
    : 'https://passport-sandbox.duitku.com/webapi/api/merchant/v2/inquiry';

  const prefix = String(opts.orderPrefix || 'INV').toUpperCase();
  const orderId = `${prefix}-${invoice.id}-${Date.now()}`;
  const amount = Number(invoice.amount || 0);
  const finalAppUrl = appUrl || settings.app_url || '';
  const productDetails =
    String(opts.itemName || invoice.item_name || '').trim() ||
    (invoice.period_month && invoice.period_year
      ? `Tagihan Internet ${invoice.period_month}/${invoice.period_year}`
      : `Pembayaran #${invoice.id}`);
  const callbackPath = String(opts.callbackPath || '/customer/payment/callback');
  const returnPath = String(opts.returnPath || '/customer/dashboard');

  // Signature: md5(merchantCode + merchantOrderId + paymentAmount + apiKey)
  const signature = crypto.createHash('md5')
    .update(merchantCode + orderId + amount + apiKey)
    .digest('hex');

  const payload = {
    merchantCode,
    paymentAmount: amount,
    merchantOrderId: orderId,
    productDetails: productDetails,
    email: customer.email || getFallbackEmail(customer.phone),
    phoneNumber: normalizePhone(customer.phone),
    customerVaName: customer.name,
    callbackUrl: `${finalAppUrl}${callbackPath}`,
    returnUrl: `${finalAppUrl}${returnPath}`,
    signature,
    expiryPeriod: 1440 // 24 jam
  };

  const methodMap = {
    'QRIS': 'DQ',
    'MANDIRIVA': 'M2',
    'BRIVA': 'BR',
    'BNIVA': 'I1',
    'BCAVA': 'BC',
    'PERMATAVA': 'BT'
  };
  const methodKey = String(method || '').trim().toUpperCase();
  payload.paymentMethod = methodMap[methodKey] || 'DQ';

  try {
    const res = await axios.post(baseUrl, payload);
    if (res.data && res.data.paymentUrl) {
      return {
        success: true,
        link: res.data.paymentUrl,
        reference: res.data.reference || orderId,
        order_id: orderId,
        payload: res.data
      };
    }
    throw new Error(res.data.statusMessage || 'Gagal mendapatkan payment URL dari Duitku');
  } catch (error) {
    throw formatGatewayError('Duitku', error);
  }
}

/**
 * Verifikasi Webhook Signature (Tripay)
 */
function verifyTripayWebhook(jsonBody, signature, privateKey) {
  const callbackSignature = crypto.createHmac('sha256', privateKey)
    .update(jsonBody)
    .digest('hex');
  return callbackSignature === signature;
}

/**
 * Verifikasi Webhook Signature (Midtrans)
 */
function verifyMidtransWebhook(body, serverKey) {
  const { order_id, status_code, gross_amount, signature_key } = body;
  const hash = crypto.createHash('sha512')
    .update(order_id + status_code + gross_amount + serverKey)
    .digest('hex');
  return hash === signature_key;
}

/**
 * Verifikasi Webhook Signature (Duitku)
 */
function verifyDuitkuWebhook(body, apiKey) {
  const { merchantCode, amount, merchantOrderId, signature } = body;
  const hash = crypto.createHash('md5')
    .update(merchantCode + amount + merchantOrderId + apiKey)
    .digest('hex');
  return hash === signature;
}

/**
 * Tripay: Mendapatkan Daftar Metode Pembayaran Aktif
 */
async function getTripayChannels() {
  const settings = getSettingsWithCache();
  const apiKey = settings.tripay_api_key;
  const isLive = settings.tripay_mode === 'live' || settings.tripay_mode === 'production';
  
  if (!apiKey) return [];

  const baseUrl = isLive
    ? 'https://tripay.co.id/api/merchant/payment-channel'
    : 'https://tripay.co.id/api-sandbox/merchant/payment-channel';

  try {
    const res = await axios.get(baseUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 3000
    });
    
    if (!res.data || !res.data.success) {
      logger.error('[Tripay] Response tidak success:', res.data);
      return [];
    }
    
    const allChannels = res.data.data || [];
    const activeChannels = allChannels.filter(ch => ch.active === true);
    
    logger.info(`[Tripay] Total channels: ${allChannels.length}, Active: ${activeChannels.length}`);
    return activeChannels;
  } catch (error) {
    logger.error('[Tripay] Gagal ambil channel:', error.message);
    return [];
  }
}

function isEnabledFlag(val) {
  return val === true || val === 'true' || val === 1 || val === '1' || val === 'yes';
}

function isGatewayConfigured(settings, gateway) {
  const g = String(gateway || '').toLowerCase();
  if (g === 'tripay') {
    return (
      isEnabledFlag(settings.tripay_enabled) &&
      String(settings.tripay_api_key || '').trim() &&
      String(settings.tripay_private_key || '').trim() &&
      String(settings.tripay_merchant_code || '').trim()
    );
  }
  if (g === 'midtrans') {
    return isEnabledFlag(settings.midtrans_enabled) && String(settings.midtrans_server_key || '').trim();
  }
  if (g === 'xendit') {
    return isEnabledFlag(settings.xendit_enabled) && String(settings.xendit_api_key || '').trim();
  }
  if (g === 'duitku') {
    return (
      isEnabledFlag(settings.duitku_enabled) &&
      String(settings.duitku_merchant_code || '').trim() &&
      String(settings.duitku_api_key || '').trim()
    );
  }
  return false;
}

function resolveConfiguredGatewayForAmount(settings, amount) {
  const amt = Number(amount || 0) || 0;
  const min = {
    qris_static: 0,
    tripay: 0,
    midtrans: 10000,
    xendit: 1000,
    duitku: 1000
  };

  const def = String(settings?.default_gateway || 'tripay').toLowerCase();
  const fallbackOrder = ['qris_static', 'tripay', 'xendit', 'duitku', 'midtrans'];

  const ok = (g) => {
    if (g === 'qris_static') {
      const enabled = isEnabledFlag(settings?.qris_static_enabled) && (settings?.qris_static_payload || settings?.qris_static_qr_url);
      if (!enabled) return false;
      const minAmt = min[g] ?? 0;
      return amt >= minAmt;
    }
    if (!isGatewayConfigured(settings, g)) return false;
    const minAmt = min[g] ?? 0;
    return amt >= minAmt;
  };

  if (ok(def)) return def;

  for (const g of fallbackOrder) {
    if (g === def) continue;
    if (ok(g)) return g;
  }

  return null;
}

module.exports = {
  createTripayTransaction,
  createMidtransTransaction,
  createXenditTransaction,
  createDuitkuTransaction,
  getTripayChannels,
  verifyTripayWebhook,
  verifyMidtransWebhook,
  verifyDuitkuWebhook,
  getFallbackEmail,
  isGatewayConfigured,
  resolveConfiguredGatewayForAmount
};

