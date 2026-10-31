const crypto = require('crypto');

class LicenseManager {
  constructor(db) {
    this.db = db;
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS licenses (
        key TEXT PRIMARY KEY,
        clientName TEXT NOT NULL,
        clientPhone TEXT,
        planType TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        expiresAt DATETIME,
        isActive INTEGER DEFAULT 1,
        maxDailyScrapes INTEGER DEFAULT 500,
        usedToday INTEGER DEFAULT 0,
        lastScrapeDate TEXT,
        deviceId TEXT,
        deviceInfo TEXT,
        deviceIp TEXT,
        firstActivatedAt DATETIME,
        lastAccessedAt DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_license_key ON licenses(key);

      CREATE TABLE IF NOT EXISTS license_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        licenseKey TEXT NOT NULL,
        deviceId TEXT,
        deviceInfo TEXT,
        ipAddress TEXT,
        action TEXT,
        status TEXT,
        note TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_license_logs_key ON license_logs(licenseKey);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // Ensure columns exist if table was previously created
    try {
      const existingCols = this.db.prepare('PRAGMA table_info(licenses)').all().map(c => c.name);
      if (!existingCols.includes('deviceInfo')) {
        this.db.exec('ALTER TABLE licenses ADD COLUMN deviceInfo TEXT');
      }
      if (!existingCols.includes('deviceIp')) {
        this.db.exec('ALTER TABLE licenses ADD COLUMN deviceIp TEXT');
      }
      if (!existingCols.includes('firstActivatedAt')) {
        this.db.exec('ALTER TABLE licenses ADD COLUMN firstActivatedAt DATETIME');
      }
    } catch (e) {
      console.warn('[License] Column migration notice:', e.message);
    }

    // Ensure default settings exist
    this.ensureDefaultSettings();
    // Ensure an initial Lifetime Master key exists for the owner
    this.ensureInitialMasterKey();
  }

  addLog({ licenseKey, deviceId = '', deviceInfo = '', ipAddress = '', action = 'TRUY CẬP', status = 'SUCCESS', note = '' }) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO license_logs (licenseKey, deviceId, deviceInfo, ipAddress, action, status, note)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(licenseKey, deviceId, deviceInfo, ipAddress, action, status, note);
    } catch (e) {
      console.warn('[License Log Error]:', e.message);
    }
  }

  getMasterKey() {
    return (process.env.ADMIN_MASTER_KEY || 'ADMIN-DEV5S-2026').trim().toUpperCase();
  }

  ensureDefaultSettings() {
    const defaultSettings = {
      adminPassword: process.env.ADMIN_PASSWORD || 'admin888', // Environment or default admin password
      bankCode: 'MB', // MB Bank, VCB, Techcombank, etc.
      bankAccount: '0969999888',
      bankName: 'NGUYEN VAN A',
      hotline: '0969.999.888',
      zaloSupport: 'https://zalo.me/0969999888',
      proxyUrl: process.env.PROXY_URL || '',
      zaloApiKey: process.env.ZALO_CHECK_API_KEY || ''
    };

    const getStmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const setStmt = this.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');

    for (const [k, v] of Object.entries(defaultSettings)) {
      setStmt.run(k, v);
    }
  }

  ensureInitialMasterKey() {
    const adminMasterKey = this.getMasterKey();
    
    // Xóa key cũ nếu có trong DB để đảm bảo chỉ có 1 Master Key duy nhất
    try {
      this.db.prepare("DELETE FROM licenses WHERE key = 'LEAD-PRO-VIP-MASTER888'").run();
    } catch (e) {}

    const existing = this.getLicense(adminMasterKey);
    if (!existing) {
      console.log(`[License] Khởi tạo Master Key Admin Đa Thiết Bị: ${adminMasterKey}...`);
      const stmt = this.db.prepare(`
        INSERT INTO licenses (
          key, clientName, clientPhone, planType, expiresAt, isActive, maxDailyScrapes, deviceId
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      `);
      stmt.run(
        adminMasterKey,
        'Admin Quản Trị Viên (Toàn Quyền Đa Thiết Bị)',
        '0969999888',
        'lifetime',
        null, // Không bao giờ hết hạn
        1,
        999999
      );
      console.log(`[License] Master Key Admin sẵn sàng: ${adminMasterKey} (Đăng nhập mọi thiết bị)`);
    } else {
      // Đảm bảo key Admin luôn ở trạng thái mở khóa đa thiết bị
      this.db.prepare(`
        UPDATE licenses 
        SET deviceId = NULL, isActive = 1, planType = 'lifetime', expiresAt = NULL, maxDailyScrapes = 999999
        WHERE key = ?
      `).run(adminMasterKey);
      console.log(`[License] Master Key Admin hiện hữu: ${adminMasterKey} (Đăng nhập mọi thiết bị)`);
    }
  }

  generateKeyString(planType) {
    const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    let typeTag = 'VIP';
    if (planType === 'trial_1d') typeTag = '1D';
    else if (planType === 'month_1m') typeTag = '30D';
    else if (planType === 'month_3m') typeTag = '90D';
    else if (planType === 'year_1y') typeTag = '365D';
    else if (planType === 'year_3y') typeTag = '3Y';
    else if (planType === 'lifetime') typeTag = 'LIFE';

    return `LEAD-${typeTag}-${randomHex}`;
  }

  calculateExpiry(planType) {
    const now = new Date();
    if (planType === 'trial_1d') {
      now.setDate(now.getDate() + 1);
      return now.toISOString();
    } else if (planType === 'month_1m') {
      now.setDate(now.getDate() + 30);
      return now.toISOString();
    } else if (planType === 'month_3m') {
      now.setDate(now.getDate() + 90);
      return now.toISOString();
    } else if (planType === 'year_1y') {
      now.setDate(now.getDate() + 365);
      return now.toISOString();
    } else if (planType === 'year_3y') {
      now.setDate(now.getDate() + (365 * 3));
      return now.toISOString();
    } else if (planType === 'lifetime') {
      return null; // Never expires
    }
    now.setDate(now.getDate() + 30);
    return now.toISOString();
  }

  createLicense({ clientName, clientPhone, planType = 'month_1m', maxDailyScrapes = 1000 }) {
    const key = this.generateKeyString(planType);
    const expiresAt = this.calculateExpiry(planType);

    const stmt = this.db.prepare(`
      INSERT INTO licenses (
        key, clientName, clientPhone, planType, expiresAt, isActive, maxDailyScrapes
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      key,
      clientName ? clientName.trim() : 'Khách Hàng',
      clientPhone ? clientPhone.trim() : '',
      planType,
      expiresAt,
      1,
      parseInt(maxDailyScrapes) || 1000
    );

    return this.getLicense(key);
  }

  getLicense(key) {
    const stmt = this.db.prepare('SELECT * FROM licenses WHERE key = ?');
    return stmt.get(key);
  }

  getAllLicenses() {
    const stmt = this.db.prepare('SELECT * FROM licenses ORDER BY createdAt DESC');
    return stmt.all();
  }

  verifyLicense(key, deviceId, deviceInfo = '', clientIp = '') {
    if (!key) {
      return { valid: false, reason: 'Vui lòng nhập License Key bản quyền để kích hoạt công cụ!' };
    }

    const cleanKey = key.trim().toUpperCase();
    const license = this.getLicense(cleanKey);

    if (!license) {
      return { valid: false, reason: 'License Key không tồn tại trên hệ thống hoặc đã bị hủy!' };
    }

    if (!license.isActive) {
      return { valid: false, reason: 'License Key này đang bị tạm khóa. Vui lòng liên hệ Admin để mở lại!' };
    }

    // Check expiration date
    if (license.expiresAt) {
      const expiry = new Date(license.expiresAt);
      if (expiry < new Date()) {
        return {
          valid: false,
          reason: `License Key đã hết hạn vào ngày ${expiry.toLocaleDateString('vi-VN')}! Vui lòng gia hạn để tiếp tục sử dụng.`,
          expired: true,
          license
        };
      }
    }

    // Anti-share Device Lock
    // CHÚ Ý: Master Key Admin là Key DUY NHẤT được phép đăng nhập trên nhiều thiết bị tự do không bao giờ bị khóa!
    const masterKey = this.getMasterKey();
    const isAdminMaster = (cleanKey === masterKey);

    if (!isAdminMaster && deviceId && deviceId.trim()) {
      const cleanDevId = deviceId.trim();
      if (!license.deviceId) {
        // First activation: bind to this device
        const bindStmt = this.db.prepare(`
          UPDATE licenses 
          SET deviceId = ?, deviceInfo = ?, deviceIp = ?, firstActivatedAt = CURRENT_TIMESTAMP, lastAccessedAt = CURRENT_TIMESTAMP 
          WHERE key = ?
        `);
        bindStmt.run(cleanDevId, deviceInfo || 'Thiết bị người dùng', clientIp || '', cleanKey);
        license.deviceId = cleanDevId;
        license.deviceInfo = deviceInfo || 'Thiết bị người dùng';
        license.deviceIp = clientIp || '';

        this.addLog({
          licenseKey: cleanKey,
          deviceId: cleanDevId,
          deviceInfo: deviceInfo || 'Thiết bị người dùng',
          ipAddress: clientIp || '',
          action: 'KÍCH HOẠT KHÓA MÁY',
          status: 'SUCCESS',
          note: `Khóa bản quyền vào thiết bị này thành công`
        });
      } else if (license.deviceId !== cleanDevId) {
        // BLOCKED ATTEMPT: A different device is trying to access this key!
        this.addLog({
          licenseKey: cleanKey,
          deviceId: cleanDevId,
          deviceInfo: deviceInfo || 'Thiết bị lạ',
          ipAddress: clientIp || '',
          action: 'CẢNH BÁO: PHÁT HIỆN MÁY LẠ',
          status: 'BLOCKED',
          note: `Từ chối đăng nhập. Key đã bị khóa vào máy: ${license.deviceInfo || license.deviceId}`
        });

        return {
          valid: false,
          reason: `Key này đã được kích hoạt trên một thiết bị khác (${license.deviceInfo || 'Thiết bị đã khóa'})! Cơ chế khóa thiết bị (Device Lock) chống chia sẻ Key trái phép. Vui lòng liên hệ Admin nếu bạn đã đổi máy mới.`
        };
      } else {
        // Same device accessing again: update info and last accessed
        const touchStmt = this.db.prepare(`
          UPDATE licenses 
          SET deviceInfo = COALESCE(NULLIF(?, ''), deviceInfo), deviceIp = COALESCE(NULLIF(?, ''), deviceIp), lastAccessedAt = CURRENT_TIMESTAMP 
          WHERE key = ?
        `);
        touchStmt.run(deviceInfo, clientIp, cleanKey);
      }
    } else if (isAdminMaster) {
      const touchAdmin = this.db.prepare('UPDATE licenses SET lastAccessedAt = CURRENT_TIMESTAMP WHERE key = ?');
      touchAdmin.run(cleanKey);
    }

    // Reset daily quota if new day
    const todayStr = new Date().toISOString().split('T')[0];
    if (license.lastScrapeDate !== todayStr) {
      const resetStmt = this.db.prepare('UPDATE licenses SET usedToday = 0, lastScrapeDate = ?, lastAccessedAt = CURRENT_TIMESTAMP WHERE key = ?');
      resetStmt.run(todayStr, cleanKey);
      license.usedToday = 0;
      license.lastScrapeDate = todayStr;
    }

    // Check quota
    const remaining = Math.max(0, license.maxDailyScrapes - license.usedToday);

    return {
      valid: true,
      license: {
        key: license.key,
        clientName: license.clientName,
        planType: license.planType,
        expiresAt: license.expiresAt,
        maxDailyScrapes: license.maxDailyScrapes,
        usedToday: license.usedToday,
        remainingToday: remaining,
        isLifetime: !license.expiresAt,
        isMultiDevice: isAdminMaster,
        deviceId: license.deviceId,
        deviceInfo: license.deviceInfo,
        deviceIp: license.deviceIp,
        firstActivatedAt: license.firstActivatedAt,
        lastAccessedAt: license.lastAccessedAt
      }
    };
  }

  recordUsage(key, amount = 1, deviceId = '', deviceInfo = '', clientIp = '') {
    if (!key) return;
    const cleanKey = key.trim().toUpperCase();
    const todayStr = new Date().toISOString().split('T')[0];
    const stmt = this.db.prepare(`
      UPDATE licenses 
      SET usedToday = usedToday + ?, lastScrapeDate = ?, lastAccessedAt = CURRENT_TIMESTAMP
      WHERE key = ?
    `);
    stmt.run(amount, todayStr, cleanKey);

    this.addLog({
      licenseKey: cleanKey,
      deviceId,
      deviceInfo,
      ipAddress: clientIp,
      action: 'CÀO DỮ LIỆU',
      status: 'SUCCESS',
      note: `Khai thác thành công ${amount} leads dữ liệu`
    });
  }

  getLicenseLogs(key, limit = 50) {
    const cleanKey = key ? key.trim().toUpperCase() : '';
    const stmt = this.db.prepare(`
      SELECT * FROM license_logs 
      WHERE licenseKey = ? 
      ORDER BY createdAt DESC 
      LIMIT ?
    `);
    return stmt.all(cleanKey, limit);
  }

  resetDevice(key, note = '') {
    const cleanKey = key ? key.trim().toUpperCase() : '';
    const stmt = this.db.prepare('UPDATE licenses SET deviceId = NULL, deviceInfo = NULL, deviceIp = NULL WHERE key = ?');
    const info = stmt.run(cleanKey);
    if (info.changes > 0) {
      this.addLog({
        licenseKey: cleanKey,
        action: 'MỞ KHÓA THIẾT BỊ',
        status: 'RESET',
        note: note || 'Admin đã mở khóa máy, cho phép khách hàng đổi sang thiết bị mới'
      });
      return true;
    }
    return false;
  }

  updateLicense(key, { isActive, expiresAt, maxDailyScrapes, resetDevice, clientName, clientPhone }) {
    const license = this.getLicense(key);
    if (!license) return false;

    let sql = 'UPDATE licenses SET ';
    const updates = [];
    const params = [];

    if (isActive !== undefined) {
      updates.push('isActive = ?');
      params.push(isActive ? 1 : 0);
    }
    if (expiresAt !== undefined) {
      updates.push('expiresAt = ?');
      params.push(expiresAt);
    }
    if (maxDailyScrapes !== undefined) {
      updates.push('maxDailyScrapes = ?');
      params.push(parseInt(maxDailyScrapes));
    }
    if (resetDevice) {
      updates.push('deviceId = NULL, deviceInfo = NULL, deviceIp = NULL');
      this.addLog({
        licenseKey: key,
        action: 'MỞ KHÓA THIẾT BỊ',
        status: 'RESET',
        note: 'Admin đã mở khóa máy, cho phép khách hàng đổi sang thiết bị mới'
      });
    }
    if (clientName) {
      updates.push('clientName = ?');
      params.push(clientName.trim());
    }
    if (clientPhone !== undefined) {
      updates.push('clientPhone = ?');
      params.push(clientPhone.trim());
    }

    if (updates.length === 0) return true;

    sql += updates.join(', ') + ' WHERE key = ?';
    params.push(key);

    const stmt = this.db.prepare(sql);
    const info = stmt.run(...params);
    return info.changes > 0;
  }

  deleteLicense(key) {
    const stmt = this.db.prepare('DELETE FROM licenses WHERE key = ?');
    const info = stmt.run(key);
    return info.changes > 0;
  }

  // System Settings Management
  getSetting(key) {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key);
    return row ? row.value : null;
  }

  getAllSettings() {
    const stmt = this.db.prepare('SELECT * FROM settings');
    const rows = stmt.all();
    const result = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  }

  setSetting(key, value) {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run(key, value);
    return true;
  }

  setSettings(obj) {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(obj)) {
      stmt.run(k, String(v));
    }
    return true;
  }
}

module.exports = LicenseManager;

