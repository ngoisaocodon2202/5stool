require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { scraper, VIETNAM_PROVINCES } = require('./scraper');
const zaloChecker = require('./zaloChecker');

const app = express();
const PORT = process.env.PORT || 3000;

zaloChecker.setDbGetter((key, arg) => {
  if (key === 'getLeadByPhone') return db.getByPhone(arg);
  return db.licenseManager.getSetting(key);
});

app.use(cors());
app.use(express.json());

// Serve static frontend files first
app.use(express.static(path.join(__dirname, 'public')));

// Root route sends index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin panel route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Favicon
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

// UTF-8 charset for API
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// Helper: Lấy địa chỉ IP thực tế của client
function getClientIp(req) {
  let ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
  if (typeof ip === 'string' && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  if (typeof ip === 'string' && ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  if (ip === '::1' || ip === '127.0.0.1') return '127.0.0.1 (Máy chủ/Nội bộ)';
  return ip || 'Chưa rõ IP';
}

// ==========================================
// LICENSE GUARD MIDDLEWARE
// ==========================================
function requireLicense(req, res, next) {
  const licenseKey = req.headers['x-license-key'];
  const deviceId = req.headers['x-device-id'];
  const deviceInfo = req.headers['x-device-info'] || '';
  const clientIp = getClientIp(req);

  const check = db.licenseManager.verifyLicense(licenseKey, deviceId, deviceInfo, clientIp);
  if (!check.valid) {
    const settings = db.licenseManager.getAllSettings();
    return res.status(403).json({
      success: false,
      isLicenseError: true,
      expired: !!check.expired,
      message: check.reason,
      paymentInfo: {
        bankCode: settings.bankCode || 'MB',
        bankAccount: settings.bankAccount || '0969999888',
        bankName: settings.bankName || 'NGUYEN VAN A',
        hotline: settings.hotline || '0969.999.888',
        zaloSupport: settings.zaloSupport || 'https://zalo.me/0969999888'
      }
    });
  }

  req.license = check.license;
  req.deviceId = deviceId;
  req.deviceInfo = deviceInfo;
  req.clientIp = clientIp;
  next();
}

function requireAdmin(req, res, next) {
  const adminPassword = req.headers['x-admin-password'];
  const licenseKey = req.headers['x-license-key'];
  const masterKey = (process.env.ADMIN_MASTER_KEY || 'ADMIN-DEV5S-2026').trim().toUpperCase();
  const currentPassword = process.env.ADMIN_PASSWORD || db.licenseManager.getSetting('adminPassword') || 'admin888';

  // Nếu người dùng gửi đúng Master Key Admin -> Cho phép truy cập
  if (licenseKey && licenseKey.trim().toUpperCase() === masterKey) {
    return next();
  }

  // Nếu người dùng gửi mật khẩu Admin khớp cấu hình
  if (adminPassword && (adminPassword === currentPassword || adminPassword.trim().toUpperCase() === masterKey)) {
    return next();
  }

  return res.status(401).json({
    success: false,
    message: 'Mật khẩu quản trị viên không chính xác hoặc không có quyền truy cập!'
  });
}

// ==========================================
// PUBLIC & CLIENT LICENSE APIS
// ==========================================

// 1. GET /api/provinces - Full 63 Vietnam Provinces
app.get('/api/provinces', (req, res) => {
  res.json({
    success: true,
    provinces: VIETNAM_PROVINCES
  });
});

// 2. GET /api/system/info - Public system & payment info
app.get('/api/system/info', (req, res) => {
  const settings = db.licenseManager.getAllSettings();
  res.json({
    success: true,
    info: {
      hotline: settings.hotline || '0969.999.888',
      zaloSupport: settings.zaloSupport || 'https://zalo.me/0969999888',
      bankCode: settings.bankCode || 'MB',
      bankAccount: settings.bankAccount || '0969999888',
      bankName: settings.bankName || 'NGUYEN VAN A'
    }
  });
});

// 3. POST /api/license/verify - Client verify license key
app.post('/api/license/verify', (req, res) => {
  const { key, deviceId, deviceInfo } = req.body;
  const clientIp = getClientIp(req);
  const result = db.licenseManager.verifyLicense(key, deviceId, deviceInfo, clientIp);

  if (!result.valid) {
    const settings = db.licenseManager.getAllSettings();
    return res.json({
      success: false,
      expired: !!result.expired,
      message: result.reason,
      paymentInfo: {
        bankCode: settings.bankCode || 'MB',
        bankAccount: settings.bankAccount || '0969999888',
        bankName: settings.bankName || 'NGUYEN VAN A',
        hotline: settings.hotline || '0969.999.888',
        zaloSupport: settings.zaloSupport || 'https://zalo.me/0969999888'
      }
    });
  }

  res.json({
    success: true,
    message: 'Kích hoạt bản quyền thành công!',
    license: result.license
  });
});

// ==========================================
// CORE DATA EXTRACTION APIS (PROTECTED BY LICENSE)
// ==========================================

// 4. GET /api/leads - Filter & Query (Tenant Isolated)
app.get('/api/leads', requireLicense, (req, res) => {
  try {
    const { city, industry, role, zaloOnly, search } = req.query;
    const tenantKey = req.license.key;
    const leads = db.filter({ city, industry, role, zaloOnly, search }, tenantKey);
    const allCount = db.getStats(tenantKey).totalLeads;

    res.json({
      success: true,
      total: leads.length,
      allTotal: allCount,
      leads: leads
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. GET /api/stats - Global / Tenant Statistics
app.get('/api/stats', (req, res) => {
  try {
    const licenseKey = req.headers['x-license-key'];
    const stats = db.getStats(licenseKey);
    res.json({
      success: true,
      stats: stats
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. POST /api/leads/scan - 100-200 Leads Bulk Extraction
app.post('/api/leads/scan', requireLicense, async (req, res) => {
  try {
    const { city, industry, targetGoal = 50, skipExisting = true } = req.body;
    const goalNumber = Math.min(Math.max(parseInt(targetGoal) || 50, 5), 500);
    const tenantKey = req.license.key;

    console.log(`[API /scan] [Tenant: ${tenantKey}] Quét data: ngành="${industry}", tỉnh="${city}", số lượng=${goalNumber}, lọc trùng=${skipExisting}`);

    const newLeads = await scraper.scrapeRealEnterprises({
      keyword: (industry && industry !== 'all' && industry !== 'Mọi ngành nghề' && industry !== 'Mọi Ngành Nghề') ? industry : '',
      city: (city && city !== 'all' && city !== 'Toàn quốc' && city !== 'Mọi Tỉnh Thành') ? city : '',
      targetGoal: goalNumber,
      skipExisting: !!skipExisting,
      licenseKey: tenantKey
    });

    if (newLeads.length > 0) {
      db.batchAdd(newLeads, tenantKey);
      // Record usage for client license kèm log thiết bị
      db.licenseManager.recordUsage(tenantKey, newLeads.length, req.deviceId, req.deviceInfo, req.clientIp);
    }

    const currentTotal = db.getStats(tenantKey).totalLeads;

    res.json({
      success: true,
      message: `Đã cào thành công ${newLeads.length} dữ liệu doanh nghiệp thật kèm SĐT, MST, link nguồn & Zalo!`,
      count: newLeads.length,
      newLeads: newLeads,
      totalLeads: currentTotal,
      license: db.licenseManager.getLicense(tenantKey)
    });
  } catch (err) {
    console.error('[API /scan error]:', err.message);
    res.status(500).json({
      success: false,
      message: `Lỗi cào dữ liệu: ${err.message}`
    });
  }
});

// 7. POST /api/leads/scan-facebook - Direct Public Facebook Scraper
app.post('/api/leads/scan-facebook', requireLicense, async (req, res) => {
  try {
    const { url } = req.body;
    const tenantKey = req.license.key;

    if (!url || !url.includes('facebook.com')) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đường dẫn Fanpage hoặc bài viết Facebook hợp lệ!'
      });
    }

    console.log(`[API /scan-facebook] [Tenant: ${tenantKey}] Cào URL Facebook: ${url}`);
    const leads = await scraper.scrapeFacebookUrl(url.trim());

    if (leads.length > 0) {
      db.batchAdd(leads, tenantKey);
      db.licenseManager.recordUsage(tenantKey, leads.length);
    }

    const currentTotal = db.getStats(tenantKey).totalLeads;

    res.json({
      success: true,
      message: `Đã bóc tách thành công thông tin thật từ Facebook!`,
      count: leads.length,
      newLeads: leads,
      totalLeads: currentTotal
    });
  } catch (err) {
    console.error('[API /scan-facebook error]:', err.message);
    res.status(500).json({
      success: false,
      message: `Lỗi bóc tách Facebook: ${err.message}`
    });
  }
});

// 8. POST /api/zalo/check - Bulk Check Zalo status (Active vs Null/Not Found)
app.post('/api/zalo/check', requireLicense, async (req, res) => {
  try {
    const { phones } = req.body;
    const tenantKey = req.license.key;
    let targetPhones = [];

    if (phones && Array.isArray(phones)) {
      targetPhones = phones;
    } else {
      const tenantLeads = db.getAll(tenantKey);
      targetPhones = tenantLeads.map(l => l.phone);
    }

    console.log(`[API /zalo/check] [Tenant: ${tenantKey}] Bắt đầu kiểm tra Zalo cho ${targetPhones.length} số điện thoại...`);
    const results = await zaloChecker.checkBatch(targetPhones);

    // Kiểm tra nếu phiên Cookie Zalo bị hết hạn hoặc lỗi kết nối -> Cảnh báo ngay lập tức, không ghi đè hỏng dữ liệu
    const sessionErr = results.find(r => r.sessionError);
    if (sessionErr) {
      console.warn(`[API /zalo/check] Lỗi phiên Zalo:`, sessionErr.reason);
      return res.status(400).json({
        success: false,
        sessionError: true,
        sessionStatus: sessionErr.sessionStatus,
        message: sessionErr.reason || 'Cookie Zalo đã hết hạn (Lỗi 102). Vui lòng vào Cổng Quản Trị (Admin) để cập nhật Cookie zpw_sek mới!'
      });
    }

    let activeCount = 0;
    let notFoundCount = 0;
    for (const r of results) {
      db.updateZaloStatus(r.phone, r.zaloActive ? 1 : 0, r.zaloName || '', r.zaloAvatar || '', tenantKey);
      if (r.zaloActive) activeCount++;
      else notFoundCount++;
    }

    res.json({
      success: true,
      message: `Đã kiểm tra xong ${targetPhones.length} số: ${activeCount} số Có Zalo (Active), ${notFoundCount} số Không có Zalo (Null / Not Found)!`,
      activeCount,
      notFoundCount,
      results: results
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 9. POST /api/leads/deduplicate - Deduplicate & Normalize
app.post('/api/leads/deduplicate', requireLicense, (req, res) => {
  try {
    const tenantKey = req.license.key;
    const allLeads = db.getAll(tenantKey);
    const initialCount = allLeads.length;
    const seenPhones = new Set();
    const cleanLeads = [];

    for (const lead of allLeads) {
      let normPhone = lead.phone.replace(/[^0-9+]/g, '');
      if (normPhone.startsWith('+84')) {
        normPhone = '0' + normPhone.slice(3);
      } else if (normPhone.startsWith('84') && normPhone.length === 11) {
        normPhone = '0' + normPhone.slice(2);
      }
      lead.phone = normPhone;

      if (!seenPhones.has(normPhone)) {
        seenPhones.add(normPhone);
        cleanLeads.push(lead);
      }
    }

    const removedCount = initialCount - cleanLeads.length;
    if (removedCount > 0) {
      db.clearAll(tenantKey);
      db.batchAdd(cleanLeads, tenantKey);
    }

    res.json({
      success: true,
      message: `Đã chuẩn hóa và loại bỏ ${removedCount} số điện thoại trùng lặp!`,
      removedCount: removedCount,
      remainingCount: cleanLeads.length,
      leads: cleanLeads
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 10. POST /api/leads - Manual add
app.post('/api/leads', requireLicense, async (req, res) => {
  try {
    const { company, contactName, role, phone, email, city, address, industry, taxCode, website } = req.body;
    const tenantKey = req.license.key;

    if (!company || !phone) {
      return res.status(400).json({ success: false, message: "Tên công ty và số điện thoại là bắt buộc!" });
    }

    let normPhone = phone.replace(/[^0-9+]/g, '');
    if (normPhone.startsWith('+84')) normPhone = '0' + normPhone.slice(3);

    const carrier = zaloChecker.getCarrier(normPhone);
    const zaloStatus = await zaloChecker.checkPhone(normPhone);

    const newLead = {
      id: `LD-${Date.now().toString().slice(-6)}`,
      company: company.trim(),
      contactName: contactName ? contactName.trim() : "Chủ doanh nghiệp",
      role: role ? role.trim() : "Giám đốc điều hành",
      phone: normPhone,
      carrier: carrier,
      email: email ? email.trim() : '',
      city: city || "Toàn quốc",
      address: address ? address.trim() : "Việt Nam",
      industry: industry || "Chung",
      taxCode: taxCode || '',
      website: website || '',
      status: "Đã xác thực",
      zaloActive: zaloStatus.zaloActive,
      zaloName: zaloStatus.zaloName || contactName || company,
      zaloAvatar: zaloStatus.zaloAvatar || '',
      verifiedAt: new Date().toISOString().split('T')[0],
      source: "Thủ công (Người dùng)",
      sourceUrl: ''
    };

    db.add(newLead, tenantKey);

    res.json({
      success: true,
      message: "Thêm khách hàng thành công!",
      lead: newLead,
      totalLeads: db.getStats(tenantKey).totalLeads
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 11. DELETE /api/leads/:id
app.delete('/api/leads/:id', requireLicense, (req, res) => {
  try {
    const { id } = req.params;
    const tenantKey = req.license.key;
    const ok = db.delete(id, tenantKey);
    if (!ok) return res.status(404).json({ success: false, message: "Không tìm thấy dữ liệu cần xóa!" });

    res.json({
      success: true,
      message: "Đã xóa lead thành công!",
      remainingCount: db.getStats(tenantKey).totalLeads
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 12. DELETE /api/leads - Clear all
app.delete('/api/leads', requireLicense, (req, res) => {
  try {
    const tenantKey = req.license.key;
    db.clearAll(tenantKey);
    res.json({
      success: true,
      message: "Đã làm sạch toàn bộ kho dữ liệu leads của bạn!",
      remainingCount: 0
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// ADMIN DASHBOARD & LICENSE MANAGEMENT APIS
// ==========================================

// 13. POST /api/admin/login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const masterKey = (process.env.ADMIN_MASTER_KEY || 'ADMIN-DEV5S-2026').trim().toUpperCase();
  const currentPassword = process.env.ADMIN_PASSWORD || db.licenseManager.getSetting('adminPassword') || 'admin888';

  if (password === currentPassword || (password && password.trim().toUpperCase() === masterKey)) {
    res.json({ success: true, message: 'Đăng nhập Admin thành công!', token: masterKey });
  } else {
    res.status(401).json({ success: false, message: 'Mật khẩu quản trị viên không chính xác!' });
  }
});

// 14. GET /api/admin/licenses - List all client keys
app.get('/api/admin/licenses', requireAdmin, (req, res) => {
  try {
    const licenses = db.licenseManager.getAllLicenses();
    res.json({ success: true, licenses });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 15. POST /api/admin/licenses - Create new license key
app.post('/api/admin/licenses', requireAdmin, (req, res) => {
  try {
    const { clientName, clientPhone, planType, maxDailyScrapes } = req.body;
    const newLicense = db.licenseManager.createLicense({
      clientName,
      clientPhone,
      planType,
      maxDailyScrapes
    });

    res.json({
      success: true,
      message: `Đã tạo License Key mới thành công: ${newLicense.key}`,
      license: newLicense
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 16. PUT /api/admin/licenses/:key - Update license (extend, lock, reset device)
app.put('/api/admin/licenses/:key', requireAdmin, (req, res) => {
  try {
    const { key } = req.params;
    const ok = db.licenseManager.updateLicense(key, req.body);
    if (!ok) return res.status(404).json({ success: false, message: "Không tìm thấy key!" });

    res.json({
      success: true,
      message: 'Cập nhật License Key thành công!',
      license: db.licenseManager.getLicense(key)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 17. DELETE /api/admin/licenses/:key - Delete key
app.delete('/api/admin/licenses/:key', requireAdmin, (req, res) => {
  try {
    const { key } = req.params;
    const ok = db.licenseManager.deleteLicense(key);
    res.json({ success: true, message: 'Đã xóa License Key thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 17.1. GET /api/admin/licenses/:key/logs - Chi tiết thiết bị & lịch sử log đối chứng
app.get('/api/admin/licenses/:key/logs', requireAdmin, (req, res) => {
  try {
    const { key } = req.params;
    const license = db.licenseManager.getLicense(key);
    if (!license) return res.status(404).json({ success: false, message: 'Không tìm thấy Key!' });
    const logs = db.licenseManager.getLicenseLogs(key, 100);
    res.json({ success: true, license, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 17.2. POST /api/admin/licenses/:key/reset-device - Mở khóa thiết bị để đổi máy cho khách
app.post('/api/admin/licenses/:key/reset-device', requireAdmin, (req, res) => {
  try {
    const { key } = req.params;
    const { note } = req.body || {};
    const ok = db.licenseManager.resetDevice(key, note);
    if (!ok) return res.status(404).json({ success: false, message: 'Không tìm thấy Key hoặc lỗi mở khóa!' });
    res.json({ 
      success: true, 
      message: 'Đã mở khóa thiết bị thành công! Khách hàng có thể kích hoạt trên máy mới ngay lập tức.' 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 18. GET /api/admin/settings
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  try {
    const settings = db.licenseManager.getAllSettings();
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 19. POST /api/admin/settings - Save system settings (VietQR, Admin password, Proxy)
app.post('/api/admin/settings', requireAdmin, (req, res) => {
  try {
    db.licenseManager.setSettings(req.body);
    res.json({ success: true, message: 'Đã lưu cấu hình hệ thống thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 20. POST /api/admin/zalo/session - Connect real Zalo session & API Key
app.post('/api/admin/zalo/session', requireAdmin, (req, res) => {
  try {
    const { cookie, accountInfo, apiKey, apiUrl, zaloCookie, zaloApiKey, zaloApiUrl } = req.body;
    const finalCookie = cookie !== undefined ? cookie : zaloCookie;
    const finalApiKey = apiKey !== undefined ? apiKey : zaloApiKey;
    const finalApiUrl = apiUrl !== undefined ? apiUrl : zaloApiUrl;

    if (finalCookie !== undefined) {
      if (finalCookie) zaloChecker.saveSession(finalCookie, accountInfo || {});
      db.licenseManager.setSetting('zaloCookie', finalCookie || '');
    }
    if (finalApiKey !== undefined) db.licenseManager.setSetting('zaloApiKey', finalApiKey || '');
    if (finalApiUrl !== undefined) db.licenseManager.setSetting('zaloApiUrl', finalApiUrl || '');

    res.json({ success: true, message: 'Đã lưu cấu hình kết nối API & Cookie Zalo thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 21. POST /api/admin/zalo/test - Live test any phone number
app.post('/api/admin/zalo/test', requireAdmin, async (req, res) => {
  try {
    const { phone, cookie, apiKey, apiUrl, zaloCookie, zaloApiKey, zaloApiUrl } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập số điện thoại cần kiểm tra!' });
    }

    const testCookie = cookie !== undefined ? cookie : (zaloCookie !== undefined ? zaloCookie : db.licenseManager.getSetting('zaloCookie'));
    const testApiKey = apiKey !== undefined ? apiKey : (zaloApiKey !== undefined ? zaloApiKey : db.licenseManager.getSetting('zaloApiKey'));
    const testApiUrl = apiUrl !== undefined ? apiUrl : (zaloApiUrl !== undefined ? zaloApiUrl : db.licenseManager.getSetting('zaloApiUrl'));

    const result = await zaloChecker.checkPhone(phone, testApiKey, testCookie, testApiUrl);
    res.json({
      success: true,
      result: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 22. GET /api/admin/zalo/session-status - Live check current Zalo cookie
app.get('/api/admin/zalo/session-status', requireAdmin, async (req, res) => {
  try {
    const cookie = db.licenseManager.getSetting('zaloCookie');
    const status = await zaloChecker.checkSessionStatus(cookie);
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Start Server
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    const masterKey = (process.env.ADMIN_MASTER_KEY || 'ADMIN-DEV5S-2026').trim().toUpperCase();
    console.log(`=======================================================`);
    console.log(`🚀 Nền Tảng SaaS Quét Lead B2B (Phiên Bản Thương Mại V5.0)`);
    console.log(`📡 Server: http://localhost:${PORT}`);
    console.log(`🔑 Master Key Admin: ${masterKey}`);
    console.log(`🛡️  Mật Khẩu Admin: ${process.env.ADMIN_PASSWORD || db.licenseManager.getSetting('adminPassword') || 'admin888'}`);
    console.log(`💾 SQLite DB: leads.db (Multi-Tenancy Active)`);
    console.log(`🌐 Scraper Browser: ${scraper.browserPath || 'Chưa cài Chrome'}`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
