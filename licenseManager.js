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

    this.ensureDefaultSettings();
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

  getLockedGoogleMapsKey() {
    return (process.env.GOOGLE_MAPS_API_KEY || Buffer.from('QUl6YVN5QWpvM0hlSmNOcVpKTk8xeWdiMTV1ODZhSDY4YmlFX2VF', 'base64').toString('utf8')).trim();
  }

  ensureDefaultSettings() {
    const lockedMapsKey = this.getLockedGoogleMapsKey();
    const defaultSettings = {
      adminPassword: process.env.ADMIN_PASSWORD || 'admin888',
      bankCode: 'MB',
      bankAccount: '789220206',
      bankName: 'NGUYEN QUOC KHAI',
      hotline: '086.2034.101',
      zaloSupport: 'https://zalo.me/0862034101',
      proxyUrl: process.env.PROXY_URL || '',
      zaloApiKey: process.env.ZALO_CHECK_API_KEY || '',
      googleMapsApiKey: lockedMapsKey
    };

    const setStmt = this.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(defaultSettings)) {
      setStmt.run(k, v);
    }
    // Luôn gắn cố định và khóa Google Maps API Key vào hệ thống
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('googleMapsApiKey', lockedMapsKey);
  }

  ensureInitialMasterKey() {
    const adminMasterKey = this.getMasterKey();

    try {
      this.db.prepare("DELETE FROM licenses WHERE key = 'LEAD-PRO-VIP-MASTER888'").run();
    } catch (e) {}

    const existing = this.getLicense(adminMasterKey);
    if (!existing) {
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
        null,
        1,
        999999
      );
    } else {
      this.db.prepare(`
        UPDATE licenses 
        SET deviceId = NULL, isActive = 1, planType = 'lifetime', expiresAt = NULL, maxDailyScrapes = 999999
        WHERE key = ?
      `).run(adminMasterKey);
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

  getPlanDefaultsFromTag(tag) {
    switch (tag) {
      case '1D':
        return { planType: 'trial_1d', maxDailyScrapes: 200 };
      case '30D':
        return { planType: 'month_1m', maxDailyScrapes: 6000 };
      case '90D':
        return { planType: 'month_3m', maxDailyScrapes: 18000 };
      case '365D':
        return { planType: 'year_1y', maxDailyScrapes: 73000 };
      case '3Y':
        return { planType: 'year_3y', maxDailyScrapes: 146000 };
      case 'LIFE':
      case 'VIP':
        return { planType: 'lifetime', maxDailyScrapes: 999999 };
      default:
        return { planType: 'month_1m', maxDailyScrapes: 6000 };
    }
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
      return null;
    }
    now.setDate(now.getDate() + 30);
    return now.toISOString();
  }

  createLicense({ clientName, clientPhone, planType = 'month_1m', maxDailyScrapes = 6000 }) {
    const key = this.generateKeyString(planType);
    const expiresAt = this.calculateExpiry(planType);

    const stmt = this.db.prepare(`
      INSERT INTO licenses (
        key, clientName, clientPhone, planType, expiresAt, isActive, maxDailyScrapes, deviceId
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `);

    stmt.run(
      key,
      clientName ? clientName.trim() : 'Khách Hàng VIP',
      clientPhone ? clientPhone.trim() : '',
      planType,
      expiresAt,
      1,
      parseInt(maxDailyScrapes) || 6000
    );

    return this.getLicense(key);
  }

  getLicense(key) {
    if (!key) return null;
    const stmt = this.db.prepare('SELECT * FROM licenses WHERE key = ?');
    return stmt.get(key.trim().toUpperCase());
  }

  // Auto-recover valid LEAD-* keys if Serverless instance cold-started
  ensureKeyRecoveredIfValidFormat(cleanKey) {
    let license = this.getLicense(cleanKey);
    if (license) return license;

    const match = cleanKey.match(/^LEAD-(1D|30D|90D|365D|3Y|LIFE|VIP)-([A-Z0-9]{6,12})$/);
    if (match) {
      const tag = match[1];
      const { planType, maxDailyScrapes } = this.getPlanDefaultsFromTag(tag);
      const expiresAt = this.calculateExpiry(planType);
      try {
        const stmt = this.db.prepare(`
          INSERT OR IGNORE INTO licenses (
            key, clientName, clientPhone, planType, expiresAt, isActive, maxDailyScrapes, deviceId
          ) VALUES (?, ?, ?, ?, ?, 1, ?, NULL)
        `);
        stmt.run(cleanKey, `Khách Hàng (${tag})`, '', planType, expiresAt, maxDailyScrapes);
        license = this.getLicense(cleanKey);
      } catch (e) {
        console.warn('[License] Auto-recover error:', e.message);
      }
    }
    return license;
  }

  getAllLicenses() {
    const stmt = this.db.prepare('SELECT * FROM licenses ORDER BY createdAt DESC');
    return stmt.all();
  }

  // Extract OS + Browser core signature (ignoring screen resolution changes from mobile address bar or DevTools)
  extractCoreDeviceSignature(deviceInfo = '') {
    if (!deviceInfo) return '';
    return String(deviceInfo)
      .split('•')
      .slice(0, 2)
      .map(s => s.trim().toLowerCase())
      .join('|');
  }

  verifyLicense(key, deviceId, deviceInfo = '', clientIp = '') {
    if (!key) {
      return { valid: false, reason: 'Vui lòng nhập License Key bản quyền để kích hoạt công cụ!' };
    }

    const cleanKey = key.trim().toUpperCase();
    const license = this.ensureKeyRecoveredIfValidFormat(cleanKey);

    if (!license) {
      return { valid: false, reason: 'License Key không tồn tại trên hệ thống hoặc đã bị hủy!' };
    }

    if (!license.isActive) {
      return { valid: false, reason: 'License Key này đang bị tạm khóa. Vui lòng liên hệ Admin để mở lại!' };
    }

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
          note: 'Khóa bản quyền vào thiết bị khách hàng thành công'
        });
      } else if (license.deviceId !== cleanDevId) {
        // Check if this is actually the SAME physical device whose screen resolution changed (e.g. mobile address bar, DevTools, or reload)
        const storedCore = this.extractCoreDeviceSignature(license.deviceInfo);
        const incomingCore = this.extractCoreDeviceSignature(deviceInfo);
        const isSameIpAndOs = Boolean(
          storedCore &&
          incomingCore &&
          storedCore === incomingCore &&
          license.deviceIp &&
          clientIp &&
          license.deviceIp === clientIp
        );

        if (isSameIpAndOs) {
          // Update deviceId seamlessly so reload on the same machine never locks out the user
          const updateDevStmt = this.db.prepare(`
            UPDATE licenses
            SET deviceId = ?, deviceInfo = COALESCE(NULLIF(?, ''), deviceInfo), lastAccessedAt = CURRENT_TIMESTAMP
            WHERE key = ?
          `);
          updateDevStmt.run(cleanDevId, deviceInfo, cleanKey);
          license.deviceId = cleanDevId;
        } else {
          // Real different device attempting to use a locked key
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
            reason: `Key này đã được kích hoạt trên một thiết bị khác (${license.deviceInfo || 'Thiết bị đã khóa'})! Vui lòng mở Cổng Admin nhấn "Mở Khóa Máy" nếu bạn muốn đổi thiết bị.`
          };
        }
      } else {
        // Same device accessing again
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

    const remaining = Math.max(0, license.maxDailyScrapes - license.usedToday);

    return {
      valid: true,
      license: {
        key: license.key,
        clientName: license.clientName,
        clientPhone: license.clientPhone || '',
        planType: license.planType,
        expiresAt: license.expiresAt,
        maxDailyScrapes: license.maxDailyScrapes,
        usedToday: license.usedToday,
        remainingToday: remaining,
        isLifetime: !license.expiresAt || license.planType === 'lifetime',
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
        note: note || 'Admin đã mở khóa máy, cho phép khách hàng kích hoạt lại hoặc đổi thiết bị mới'
      });
      return true;
    }
    return false;
  }

  updateLicense(key, { isActive, expiresAt, maxDailyScrapes, resetDevice, clientName, clientPhone }) {
    const cleanKey = key ? key.trim().toUpperCase() : '';
    const license = this.getLicense(cleanKey);
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
        licenseKey: cleanKey,
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
    params.push(cleanKey);

    const stmt = this.db.prepare(sql);
    const info = stmt.run(...params);
    return info.changes > 0;
  }

  deleteLicense(key) {
    const cleanKey = key ? key.trim().toUpperCase() : '';
    const stmt = this.db.prepare('DELETE FROM licenses WHERE key = ?');
    const info = stmt.run(cleanKey);
    return info.changes > 0;
  }

  getSetting(key) {
    if (key === 'googleMapsApiKey') {
      return this.getLockedGoogleMapsKey();
    }
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
    // Luôn ẩn nửa sau của Google Maps API Key để chống lộ hoặc bị sao chép từ API/Network
    const realKey = this.getLockedGoogleMapsKey();
    result.googleMapsApiKey = realKey ? (realKey.slice(0, 14) + '•••••••••••••••••••••••••') : '';
    return result;
  }

  setSetting(key, value) {
    if (key === 'googleMapsApiKey') {
      // Khóa cứng: không cho phép ghi đè key đã khóa bằng chuỗi che hoặc rỗng
      if (!value || String(value).includes('•') || String(value).includes('*')) {
        return true;
      }
    }
    const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run(key, String(value ?? ''));
    return true;
  }

  setSettings(obj) {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'googleMapsApiKey') {
        // Khóa cứng key: bỏ qua nếu chuỗi bị ẩn hoặc rỗng
        if (!v || String(v).includes('•') || String(v).includes('*')) continue;
      }
      if (v !== undefined && v !== null) {
        stmt.run(k, String(v));
      }
    }
    return true;
  }

  exportBackupData() {
    return {
      version: '5.5.0-enterprise',
      exportedAt: new Date().toISOString(),
      licenses: this.getAllLicenses(),
      settings: this.getAllSettings()
    };
  }

  importBackupData(payload = {}) {
    let importedLicenses = 0;
    if (payload.settings && typeof payload.settings === 'object') {
      this.setSettings(payload.settings);
    }
    if (Array.isArray(payload.licenses)) {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO licenses (
          key, clientName, clientPhone, planType, createdAt, expiresAt,
          isActive, maxDailyScrapes, usedToday, lastScrapeDate,
          deviceId, deviceInfo, deviceIp, firstActivatedAt, lastAccessedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const lic of payload.licenses) {
        if (!lic || !lic.key) continue;
        stmt.run(
          lic.key,
          lic.clientName || 'Khách Hàng',
          lic.clientPhone || '',
          lic.planType || 'month_1m',
          lic.createdAt || new Date().toISOString(),
          lic.expiresAt || null,
          lic.isActive !== undefined ? (lic.isActive ? 1 : 0) : 1,
          lic.maxDailyScrapes || 6000,
          lic.usedToday || 0,
          lic.lastScrapeDate || null,
          lic.deviceId || null,
          lic.deviceInfo || null,
          lic.deviceIp || null,
          lic.firstActivatedAt || null,
          lic.lastAccessedAt || null
        );
        importedLicenses++;
      }
    }
    this.ensureInitialMasterKey();
    return { importedLicenses };
  }
}

module.exports = LicenseManager;
