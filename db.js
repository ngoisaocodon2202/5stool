const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const LicenseManager = require('./licenseManager');

const isVercel = Boolean(process.env.VERCEL);
const DB_PATH = isVercel ? path.join('/tmp', 'leads.db') : path.join(__dirname, 'leads.db');
const JSON_BACKUP = path.join(__dirname, 'db.json');

class DatabaseManager {
  constructor() {
    if (isVercel && !fs.existsSync(DB_PATH)) {
      const sourceDb = path.join(__dirname, 'leads.db');
      if (fs.existsSync(sourceDb)) {
        try {
          fs.copyFileSync(sourceDb, DB_PATH);
        } catch (e) {
          console.warn('[DB] Could not copy leads.db to /tmp:', e.message);
        }
      }
    }
    this.db = new DatabaseSync(DB_PATH);
    this.init();
    this.licenseManager = new LicenseManager(this.db);
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        company TEXT NOT NULL,
        contactName TEXT,
        role TEXT,
        phone TEXT NOT NULL,
        carrier TEXT,
        email TEXT,
        city TEXT,
        address TEXT,
        industry TEXT,
        taxCode TEXT,
        website TEXT,
        status TEXT,
        zaloActive INTEGER DEFAULT 0,
        zaloName TEXT,
        zaloAvatar TEXT,
        source TEXT,
        sourceUrl TEXT,
        snippet TEXT,
        verifiedAt TEXT,
        licenseKey TEXT DEFAULT 'MASTER',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_phone ON leads(phone);
      CREATE INDEX IF NOT EXISTS idx_city ON leads(city);
      CREATE INDEX IF NOT EXISTS idx_industry ON leads(industry);
    `);

    // Migration: Kiểm tra và thêm cột licenseKey nếu DB cũ chưa có
    try {
      const existingCols = this.db.prepare('PRAGMA table_info(leads)').all().map(c => c.name);
      if (!existingCols.includes('licenseKey')) {
        this.db.exec("ALTER TABLE leads ADD COLUMN licenseKey TEXT DEFAULT 'MASTER'");
        console.log('[DB] Migration: Đã bổ sung cột licenseKey cho hệ thống Multi-Tenancy');
      }
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_leads_licenseKey ON leads(licenseKey)");
    } catch (e) {
      console.warn('[DB] Migration column notice:', e.message);
    }

    this.migrateFromOldJson();
  }

  migrateFromOldJson() {
    try {
      const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM leads');
      const count = countStmt.get().count;
      if (count === 0 && fs.existsSync(JSON_BACKUP)) {
        const raw = fs.readFileSync(JSON_BACKUP, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.leads && Array.isArray(parsed.leads) && parsed.leads.length > 0) {
          console.log(`[DB] Migrating ${parsed.leads.length} initial leads to SQLite...`);
          this.batchAdd(parsed.leads, 'MASTER');
        }
      }
    } catch (err) {
      console.warn('[DB] Migration note:', err.message);
    }
  }

  isMaster(licenseKey) {
    if (!licenseKey) return true;
    const master = (process.env.ADMIN_MASTER_KEY || 'ADMIN-DEV5S-2026').trim().toUpperCase();
    const clean = String(licenseKey).trim().toUpperCase();
    return clean === master || clean === 'MASTER' || clean === 'ADMIN';
  }

  syncToJsonBackup() {
    try {
      const leads = this.getAll();
      const backupData = {
        version: "5.0.0-commercial-saas",
        lastUpdated: new Date().toISOString(),
        meta: {
          totalScannedAllTime: leads.length,
          validRate: 100
        },
        leads: leads
      };
      fs.writeFileSync(JSON_BACKUP, JSON.stringify(backupData, null, 2), 'utf-8');
    } catch (e) {
      console.warn('[DB] Sync to JSON backup error:', e.message);
    }
  }

  getAll(licenseKey = null) {
    let stmt;
    if (licenseKey && !this.isMaster(licenseKey)) {
      stmt = this.db.prepare('SELECT * FROM leads WHERE licenseKey = ? ORDER BY createdAt DESC');
      const rows = stmt.all(licenseKey.trim().toUpperCase());
      return rows.map(r => ({ ...r, zaloActive: !!r.zaloActive }));
    }
    stmt = this.db.prepare('SELECT * FROM leads ORDER BY createdAt DESC');
    const rows = stmt.all();
    return rows.map(r => ({ ...r, zaloActive: !!r.zaloActive }));
  }

  getAllPhones(licenseKey = null) {
    let stmt;
    if (licenseKey && !this.isMaster(licenseKey)) {
      stmt = this.db.prepare('SELECT phone FROM leads WHERE licenseKey = ?');
      const rows = stmt.all(licenseKey.trim().toUpperCase());
      return new Set(rows.map(r => r.phone.replace(/[^0-9]/g, '')));
    }
    stmt = this.db.prepare('SELECT phone FROM leads');
    const rows = stmt.all();
    return new Set(rows.map(r => r.phone.replace(/[^0-9]/g, '')));
  }

  getByPhone(phone, licenseKey = null) {
    if (!phone) return null;
    const clean = phone.replace(/[^0-9]/g, '');
    let stmt, row;
    if (licenseKey && !this.isMaster(licenseKey)) {
      stmt = this.db.prepare('SELECT * FROM leads WHERE (phone = ? OR phone LIKE ?) AND licenseKey = ? LIMIT 1');
      row = stmt.get(clean, `%${clean}%`, licenseKey.trim().toUpperCase());
    } else {
      stmt = this.db.prepare('SELECT * FROM leads WHERE phone = ? OR phone LIKE ? LIMIT 1');
      row = stmt.get(clean, `%${clean}%`);
    }
    return row ? { ...row, zaloActive: !!row.zaloActive } : null;
  }

  filter(query = {}, licenseKey = null) {
    let sql = 'SELECT * FROM leads WHERE 1=1';
    const params = [];

    if (licenseKey && !this.isMaster(licenseKey)) {
      sql += ' AND licenseKey = ?';
      params.push(licenseKey.trim().toUpperCase());
    }

    if (query.city && query.city !== 'all' && query.city !== 'Tất cả' && query.city !== 'Toàn quốc' && query.city !== 'Mọi Tỉnh Thành') {
      sql += ' AND city LIKE ?';
      params.push(`%${query.city}%`);
    }

    if (query.industry && query.industry !== 'all' && query.industry !== 'Tất cả' && query.industry !== 'Mọi ngành nghề' && query.industry !== 'Mọi Ngành Nghề') {
      sql += ' AND (industry LIKE ? OR company LIKE ?)';
      params.push(`%${query.industry}%`, `%${query.industry}%`);
    }

    if (query.role && query.role !== 'all' && query.role !== 'Tất cả') {
      sql += ' AND role LIKE ?';
      params.push(`%${query.role}%`);
    }

    if (query.zaloOnly === 'true' || query.zaloOnly === true) {
      sql += ' AND zaloActive = 1';
    }

    if (query.search && query.search.trim()) {
      const s = `%${query.search.trim()}%`;
      sql += ' AND (company LIKE ? OR contactName LIKE ? OR phone LIKE ? OR email LIKE ? OR address LIKE ? OR taxCode LIKE ?)';
      params.push(s, s, s, s, s, s);
    }

    sql += ' ORDER BY createdAt DESC';
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map(r => ({ ...r, zaloActive: !!r.zaloActive }));
  }

  add(lead, licenseKey = 'MASTER') {
    const finalKey = (licenseKey || 'MASTER').trim().toUpperCase();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO leads (
        id, company, contactName, role, phone, carrier, email, city, address,
        industry, taxCode, website, status, zaloActive, zaloName, zaloAvatar,
        source, sourceUrl, snippet, verifiedAt, licenseKey
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `);

    stmt.run(
      lead.id || `LD-${Date.now().toString().slice(-6)}`,
      lead.company || '',
      lead.contactName || 'Người đại diện',
      lead.role || 'Giám đốc',
      lead.phone,
      lead.carrier || '',
      lead.email || '',
      lead.city || 'Toàn quốc',
      lead.address || '',
      lead.industry || 'Chung',
      lead.taxCode || '',
      lead.website || '',
      lead.status || 'Đã xác thực',
      lead.zaloActive ? 1 : 0,
      lead.zaloName || '',
      lead.zaloAvatar || '',
      lead.source || 'Hệ thống Quét Data',
      lead.sourceUrl || '',
      lead.snippet || '',
      lead.verifiedAt || new Date().toISOString().split('T')[0],
      finalKey
    );

    this.syncToJsonBackup();
  }

  batchAdd(leads, licenseKey = 'MASTER') {
    let addedCount = 0;
    const finalKey = (licenseKey || 'MASTER').trim().toUpperCase();
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO leads (
        id, company, contactName, role, phone, carrier, email, city, address,
        industry, taxCode, website, status, zaloActive, zaloName, zaloAvatar,
        source, sourceUrl, snippet, verifiedAt, licenseKey
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `);

    for (const lead of leads) {
      if (!lead.phone) continue;
      try {
        const info = stmt.run(
          lead.id || `LD-${Date.now().toString().slice(-4)}${addedCount}`,
          lead.company || '',
          lead.contactName || 'Người đại diện',
          lead.role || 'Giám đốc',
          lead.phone,
          lead.carrier || '',
          lead.email || '',
          lead.city || 'Toàn quốc',
          lead.address || '',
          lead.industry || 'Chung',
          lead.taxCode || '',
          lead.website || '',
          lead.status || 'Đã xác thực',
          lead.zaloActive ? 1 : 0,
          lead.zaloName || '',
          lead.zaloAvatar || '',
          lead.source || 'Cào Web Trực Tiếp',
          lead.sourceUrl || '',
          lead.snippet || '',
          lead.verifiedAt || new Date().toISOString().split('T')[0],
          finalKey
        );
        if (info.changes > 0) addedCount++;
      } catch (e) {
        // Ignore duplicate
      }
    }

    this.syncToJsonBackup();
    return addedCount;
  }

  updateZaloStatus(phone, zaloActive, zaloName = '', zaloAvatar = '', licenseKey = null) {
    let stmt, info;
    if (licenseKey && !this.isMaster(licenseKey)) {
      stmt = this.db.prepare(`
        UPDATE leads 
        SET zaloActive = ?, zaloName = ?, zaloAvatar = ?
        WHERE phone = ? AND licenseKey = ?
      `);
      info = stmt.run(zaloActive ? 1 : 0, zaloName, zaloAvatar, phone, licenseKey.trim().toUpperCase());
    } else {
      stmt = this.db.prepare(`
        UPDATE leads 
        SET zaloActive = ?, zaloName = ?, zaloAvatar = ?
        WHERE phone = ?
      `);
      info = stmt.run(zaloActive ? 1 : 0, zaloName, zaloAvatar, phone);
    }
    this.syncToJsonBackup();
    return info.changes > 0;
  }

  delete(id, licenseKey = null) {
    let stmt, info;
    if (licenseKey && !this.isMaster(licenseKey)) {
      stmt = this.db.prepare('DELETE FROM leads WHERE id = ? AND licenseKey = ?');
      info = stmt.run(id, licenseKey.trim().toUpperCase());
    } else {
      stmt = this.db.prepare('DELETE FROM leads WHERE id = ?');
      info = stmt.run(id);
    }
    this.syncToJsonBackup();
    return info.changes > 0;
  }

  clearAll(licenseKey = null) {
    if (licenseKey && !this.isMaster(licenseKey)) {
      const stmt = this.db.prepare('DELETE FROM leads WHERE licenseKey = ?');
      stmt.run(licenseKey.trim().toUpperCase());
    } else {
      this.db.exec('DELETE FROM leads');
    }
    this.syncToJsonBackup();
  }

  getStats(licenseKey = null) {
    let totalStmt, zaloStmt, verifiedStmt;
    let total, zaloCount, verifiedCount;

    if (licenseKey && !this.isMaster(licenseKey)) {
      const cleanKey = licenseKey.trim().toUpperCase();
      totalStmt = this.db.prepare('SELECT COUNT(*) as total FROM leads WHERE licenseKey = ?');
      zaloStmt = this.db.prepare('SELECT COUNT(*) as zaloCount FROM leads WHERE zaloActive = 1 AND licenseKey = ?');
      verifiedStmt = this.db.prepare("SELECT COUNT(*) as verifiedCount FROM leads WHERE status = 'Đã xác thực' AND licenseKey = ?");

      total = totalStmt.get(cleanKey).total;
      zaloCount = zaloStmt.get(cleanKey).zaloCount;
      verifiedCount = verifiedStmt.get(cleanKey).verifiedCount;
    } else {
      totalStmt = this.db.prepare('SELECT COUNT(*) as total FROM leads');
      zaloStmt = this.db.prepare('SELECT COUNT(*) as zaloCount FROM leads WHERE zaloActive = 1');
      verifiedStmt = this.db.prepare("SELECT COUNT(*) as verifiedCount FROM leads WHERE status = 'Đã xác thực'");

      total = totalStmt.get().total;
      zaloCount = zaloStmt.get().zaloCount;
      verifiedCount = verifiedStmt.get().verifiedCount;
    }

    return {
      totalLeads: total,
      totalScannedAllTime: total,
      zaloActiveCount: zaloCount,
      verifiedCount: verifiedCount,
      accuracyRate: 100,
      speedPerDay: "100K Lead/ngày",
      speedPerMin: 500
    };
  }
}

module.exports = new DatabaseManager();
