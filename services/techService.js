const db = require('../config/database');

function authenticate(username, password) {
  const tech = db.prepare('SELECT * FROM technicians WHERE username = ? AND password = ? AND is_active = 1').get(username, password);
  return tech;
}

function getTechById(id) {
  return db.prepare('SELECT id, username, name, phone, area FROM technicians WHERE id = ?').get(id);
}

function getTechStats(techId) {
  const total = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE technician_id = ?").get(techId).count;
  const inProgress = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE technician_id = ? AND status = 'in_progress'").get(techId).count;
  const resolved = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE technician_id = ? AND status = 'resolved'").get(techId).count;
  
  let open = 0;
  if (techId) {
    const filter = getTechAreaWhere(techId, 'c');
    if (filter.isRestricted) {
      open = db.prepare(`
        SELECT COUNT(*) as count 
        FROM tickets t 
        JOIN customers c ON t.customer_id = c.id 
        WHERE t.status = 'open' AND ${filter.where}
      `).get(...filter.params).count;
    } else {
      open = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE status = 'open'").get().count;
    }
  } else {
    open = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE status = 'open'").get().count;
  }

  return { total, open, inProgress, resolved };
}

/**
 * Helper untuk membatasi query berdasarkan wilayah tugas teknisi.
 * Jika teknisi ditentukan wilayahnya (misal: "pegagan"):
 * - Teknisi HANYA bisa melihat/mengambil tiket & pelanggan di wilayahnya sendiri.
 * Jika teknisi tidak ditentukan wilayahnya (kosong / "semua" / bebas):
 * - Teknisi bisa menangani tiket di semua wilayah.
 */
function getTechAreaWhere(technician, tableAlias = 'c') {
  let tech = technician;
  if (typeof technician === 'number' || typeof technician === 'string') {
    tech = db.prepare('SELECT id, area FROM technicians WHERE id = ?').get(Number(technician));
  }
  const rawArea = String(tech?.area || '').trim();
  const areas = rawArea.split(',')
    .map(a => a.trim().toLowerCase())
    .filter(a => a.length > 0 && a !== 'semua' && a !== 'all');

  if (areas.length > 0) {
    const placeholders = areas.map(() => '?').join(', ');
    const where = `LOWER(TRIM(${tableAlias}.area)) IN (${placeholders})`;
    return { where, params: areas, isRestricted: true, areas };
  } else {
    return { where: '1=1', params: [], isRestricted: false, areas: [] };
  }
}

/**
 * Validasi apakah teknisi berhak mengakses pelanggan/wilayah tertentu.
 */
function canTechAccessCustomer(technician, customer) {
  if (!technician) return false;
  let tech = technician;
  if (typeof technician === 'number' || typeof technician === 'string') {
    tech = db.prepare('SELECT id, area FROM technicians WHERE id = ?').get(Number(technician));
  }
  const rawArea = String(tech?.area || '').trim();
  const areas = rawArea.split(',')
    .map(a => a.trim().toLowerCase())
    .filter(a => a.length > 0 && a !== 'semua' && a !== 'all');

  if (areas.length > 0) {
    const custArea = String(customer?.area || '').trim().toLowerCase();
    if (!custArea) return false;
    return areas.includes(custArea);
  }
  return true;
}

function getAssignedTickets(techId) {
  return db.prepare(`
    SELECT t.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address, c.area as customer_area 
    FROM tickets t 
    JOIN customers c ON t.customer_id = c.id 
    WHERE t.technician_id = ? AND t.status != 'resolved'
    ORDER BY t.created_at DESC
  `).all(techId);
}

function getOpenTickets(techId = null) {
  if (techId) {
    const filter = getTechAreaWhere(techId, 'c');
    if (filter.isRestricted) {
      return db.prepare(`
        SELECT t.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address, c.area as customer_area 
        FROM tickets t 
        JOIN customers c ON t.customer_id = c.id 
        WHERE t.status = 'open' AND ${filter.where}
        ORDER BY t.created_at DESC
      `).all(...filter.params);
    }
  }

  return db.prepare(`
    SELECT t.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address, c.area as customer_area 
    FROM tickets t 
    JOIN customers c ON t.customer_id = c.id 
    WHERE t.status = 'open'
    ORDER BY t.created_at DESC
  `).all();
}

function getResolvedTickets(techId) {
  return db.prepare(`
    SELECT t.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address, c.area as customer_area 
    FROM tickets t 
    JOIN customers c ON t.customer_id = c.id 
    WHERE t.technician_id = ? AND t.status = 'resolved'
    ORDER BY t.updated_at DESC LIMIT 50
  `).all(techId);
}

function takeTicket(ticketId, techId) {
  let validTechId = Number(techId);
  let tech = db.prepare('SELECT id, area FROM technicians WHERE id = ?').get(validTechId);
  if (!tech) {
    const fallback = db.prepare('SELECT id, area FROM technicians WHERE is_active = 1 ORDER BY id ASC LIMIT 1').get();
    if (fallback) {
      validTechId = fallback.id;
      tech = fallback;
    } else {
      throw new Error('Teknisi tidak ditemukan.');
    }
  }

  const ticket = db.prepare(`
    SELECT t.id, t.customer_id, t.status, c.name as customer_name, c.area as customer_area 
    FROM tickets t 
    LEFT JOIN customers c ON t.customer_id = c.id 
    WHERE t.id = ?
  `).get(ticketId);

  if (!ticket) {
    throw new Error('Tiket tidak ditemukan.');
  }

  if (ticket.status !== 'open') {
    throw new Error('Tiket sudah diambil oleh teknisi lain atau sudah selesai.');
  }

  // Validasi area
  if (ticket.customer_id && !canTechAccessCustomer(tech, { area: ticket.customer_area })) {
    throw new Error(`Tiket ini berada di wilayah "${ticket.customer_area || 'Tanpa Area'}", di luar wilayah tugas Anda (${tech.area}).`);
  }

  db.prepare("UPDATE tickets SET technician_id = ?, status = 'in_progress', updated_at = (NOW_LOCAL()) WHERE id = ?").run(validTechId, ticketId);
  return validTechId;
}

function updateTicketStatus(ticketId, techId, status, extraData = {}) {
  const { notes, photos, photoMetadata } = extraData;
  
  const updates = ['status = ?', 'updated_at = (NOW_LOCAL())'];
  const params = [status];
  
  if (techId) {
    updates.push('technician_id = COALESCE(technician_id, ?)');
    params.push(techId);
  }
  if (notes !== undefined) {
    updates.push('technician_notes = ?');
    params.push(notes);
  }
  if (photos !== undefined) {
    updates.push('photos = ?');
    params.push(photos);
  }
  if (photoMetadata !== undefined) {
    updates.push('photo_metadata = ?');
    params.push(photoMetadata);
  }
  
  params.push(ticketId);
  const sql = `UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...params);
}

// Admin helper
function getAllTechnicians() {
  return db.prepare('SELECT id, username, name, phone, area, is_active FROM technicians').all();
}

function createTechnician(data) {
  const stmt = db.prepare('INSERT INTO technicians (username, password, name, phone, area) VALUES (?, ?, ?, ?, ?)');
  return stmt.run(data.username, data.password, data.name, data.phone || '', data.area || '');
}

module.exports = {
  authenticate,
  getTechById,
  getTechAreaWhere,
  canTechAccessCustomer,
  getTechStats,
  getAssignedTickets,
  getOpenTickets,
  getResolvedTickets,
  takeTicket,
  updateTicketStatus,
  getAllTechnicians,
  createTechnician
};
