require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { scraper, VIETNAM_PROVINCES, INDUSTRY_CATALOG } = require('./scraper');
const zaloChecker = require('./zaloChecker');

const app = express();
const PORT = process.env.PORT || 3000;

zaloChecker.setDbGetter((key, arg) => {
  if (key === 'getLeadByPhone') return db.getByPhone(arg);
  return db.licenseManager.getSetting(key);
});

app.use(cors());
app.use(express.json({ limit: '15mb' }));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

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
        bankAccount: settings.bankAccount || '789220206',
        bankName: settings.bankName || 'NGUYEN QUOC KHAI',
        hotline: settings.hotline || '086.2034.101',
        zaloSupport: settings.zaloSupport || 'https://zalo.me/0862034101'
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
  const currentPassword = process.env.ADMIN_PASSWORD || db.licenseManager.getSetting('adminPassword') || 'admindev5s';

  if (licenseKey && db.licenseManager.isMasterKey(licenseKey)) {
    return next();
  }

  if (adminPassword && (adminPassword === currentPassword || db.licenseManager.isMasterKey(adminPassword))) {
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

// 1. GET /api/provinces - Full 63 Vietnam Provinces & Districts Map
app.get('/api/provinces', (req, res) => {
  res.json({
    success: true,
    provinces: VIETNAM_PROVINCES,
    districtsMap: scraper.getDistrictsMap()
  });
});

// 1.05 GET /api/districts - Districts by Province
app.get('/api/districts', (req, res) => {
  const { city } = req.query;
  res.json({
    success: true,
    city: city || 'all',
    districts: scraper.getDistrictsForCity(city)
  });
});

// 1.1 GET /api/industries - Full 24+ Business Industries Catalog
app.get('/api/industries', (req, res) => {
  res.json({
    success: true,
    industries: INDUSTRY_CATALOG || []
  });
});

// 2. GET /api/system/info - Public system & payment info
app.get('/api/system/info', (req, res) => {
  const settings = db.licenseManager.getAllSettings();
  res.json({
    success: true,
    info: {
      hotline: settings.hotline || '086.2034.101',
      zaloSupport: settings.zaloSupport || 'https://zalo.me/0862034101',
      bankCode: settings.bankCode || 'MB',
      bankAccount: settings.bankAccount || '789220206',
      bankName: settings.bankName || 'NGUYEN QUOC KHAI'
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
        bankAccount: settings.bankAccount || '789220206',
        bankName: settings.bankName || 'NGUYEN QUOC KHAI',
        hotline: settings.hotline || '086.2034.101',
        zaloSupport: settings.zaloSupport || 'https://zalo.me/0862034101'
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
    const { city, district, industry, customKeyword, role, zaloOnly, zaloStatus, carrier, mobileOnly, crmStatus, sourceType, search } = req.query;
    const tenantKey = req.license.key;
    const leads = db.filter({ city, district, industry, customKeyword, role, zaloOnly, zaloStatus, carrier, mobileOnly, crmStatus, sourceType, search }, tenantKey);
    const allCount = db.getStats(tenantKey).totalLeads;
    const districtCounts = db.getDistrictCounts(city, tenantKey);

    res.json({
      success: true,
      total: leads.length,
      allTotal: allCount,
      districtCounts,
      leads: leads
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4.1 POST /api/leads/sync - Sync Client Cached Leads back to Server (prevents data loss on Serverless cold-start reload)
app.post('/api/leads/sync', requireLicense, (req, res) => {
  try {
    const { leads } = req.body;
    const tenantKey = req.license.key;
    if (Array.isArray(leads) && leads.length > 0) {
      db.batchAdd(leads, tenantKey);
    }
    const allLeads = db.getAll(tenantKey);
    res.json({
      success: true,
      total: allLeads.length,
      leads: allLeads
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

// Helper: Estimate total available leads at a selected location (5.000 - 10.000+ leads)
function estimateLocationTotalLeads(city = '', district = '', industry = '', customKeyword = '') {
  const cleanCity = (city && city !== 'all' && city !== 'Toàn quốc' && city !== 'Mọi Tỉnh Thành') ? city.trim() : 'Toàn Quốc';
  const cleanDistrict = (district && district !== 'all' && district !== 'Tất cả Quận / Huyện' && district !== 'Tất cả Quận/Huyện') ? district.trim() : '';
  const locationLabel = cleanDistrict ? `${cleanDistrict}, ${cleanCity}` : cleanCity;

  const seedStr = `${locationLabel}|${industry || 'all'}|${customKeyword || ''}`;
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
    hash |= 0;
  }
  const absHash = Math.abs(hash);

  // Province/City or Nationwide: 6,400 - 9,850 leads; Specific District: 5,150 - 7,890 leads
  const minPool = cleanDistrict ? 5150 : 6400;
  const rangePool = cleanDistrict ? 2740 : 3450;
  const estimatedTotal = minPool + (absHash % rangePool);

  return {
    locationLabel,
    estimatedTotal
  };
}

// 6. POST /api/leads/scan - Multi-Source Bulk Extraction
app.post('/api/leads/scan', requireLicense, async (req, res) => {
  try {
    const { city, district = 'all', industry, customKeyword = '', sourceType = 'all', targetGoal = 50, skipExisting = true } = req.body;
    const goalNumber = Math.min(Math.max(parseInt(targetGoal) || 50, 5), 1000);
    const tenantKey = req.license.key;
    const isUnlimitedKey = Boolean(req.license.isUnlimited || db.licenseManager.isMasterKey(tenantKey) || req.license.planType === 'lifetime' || Number(req.license.maxDailyScrapes) >= 999999);

    const { locationLabel, estimatedTotal } = estimateLocationTotalLeads(city, district, industry, customKeyword);
    const settings = db.licenseManager.getAllSettings();
    const paymentInfo = {
      bankCode: settings.bankCode || 'MB',
      bankAccount: settings.bankAccount || '789220206',
      bankName: settings.bankName || 'NGUYEN QUOC KHAI',
      hotline: settings.hotline || '0862034101',
      zaloSupport: settings.zaloSupport || 'https://zalo.me/0862034101'
    };

    const maxQuota = isUnlimitedKey ? 999999 : (Number(req.license.maxDailyScrapes) || 200);
    const usedToday = Number(req.license.usedToday) || 0;
    const remainingBefore = isUnlimitedKey ? 999999 : Math.max(0, maxQuota - usedToday);

    // If a limited Key (e.g. 1 Ngày: 200, 1 Tháng: 6000, etc.) has reached its quota
    if (!isUnlimitedKey && remainingBefore <= 0) {
      return res.status(403).json({
        success: false,
        isQuotaError: true,
        showUpgradePopup: true,
        message: 'Bạn cần nâng cấp lên Key cao hơn để quét được nhiều dữ liệu hơn!',
        areaPotential: {
          locationLabel,
          estimatedTotal,
          extractedCount: 0,
          keyLimit: maxQuota,
          remainingQuota: 0,
          planLabel: req.license.planLabel || 'Key Hiện Tại',
          quotaBadge: req.license.quotaBadge || `${maxQuota} Leads`,
          isUnlimited: false,
          remainingCount: Math.max(0, estimatedTotal - usedToday),
          showUpgradePopup: true
        },
        paymentInfo
      });
    }

    const effectiveGoal = !isUnlimitedKey ? Math.min(goalNumber, remainingBefore) : goalNumber;

    console.log(`[API /scan] [Tenant: ${tenantKey} | ${req.license.planLabel}] Quét đa nguồn (${sourceType}): ngành="${industry}", từ khóa riêng="${customKeyword}", quận/huyện="${district}", tỉnh="${city}", số lượng=${effectiveGoal}, lọc trùng=${skipExisting}`);

    const rawNewLeads = await scraper.scrapeRealEnterprises({
      keyword: (industry && industry !== 'all' && industry !== 'Mọi ngành nghề' && industry !== 'Mọi Ngành Nghề') ? industry : '',
      customKeyword: customKeyword ? customKeyword.trim() : '',
      city: (city && city !== 'all' && city !== 'Toàn quốc' && city !== 'Mọi Tỉnh Thành') ? city : '',
      district: (district && district !== 'all' && district !== 'Tất cả Quận / Huyện' && district !== 'Tất cả Quận/Huyện') ? district : '',
      sourceType: sourceType || 'all',
      targetGoal: effectiveGoal,
      skipExisting: !!skipExisting,
      licenseKey: tenantKey
    });

    if (rawNewLeads.length > 0) {
      db.batchAdd(rawNewLeads, tenantKey);
      db.licenseManager.recordUsage(tenantKey, rawNewLeads.length, req.deviceId, req.deviceInfo, req.clientIp);
    }

    const currentTotal = db.getStats(tenantKey).totalLeads;
    // Fetch properly scoped leads for the client
    const savedTenantLeads = db.filter({ city, district, industry, customKeyword, sourceType }, tenantKey);
    const districtCounts = db.getDistrictCounts(city, tenantKey);
    const updatedLicense = db.licenseManager.getLicense(tenantKey);
    const remAfter = isUnlimitedKey ? 999999 : (updatedLicense ? updatedLicense.remainingToday : Math.max(0, remainingBefore - rawNewLeads.length));
    const shouldSuggestUpgrade = !isUnlimitedKey && (estimatedTotal > maxQuota || estimatedTotal > remAfter || remAfter <= 0);

    res.json({
      success: true,
      message: `Đã cào thành công ${rawNewLeads.length} dữ liệu doanh nghiệp thật kèm SĐT, MST, link nguồn & trạng thái Zalo!`,
      count: rawNewLeads.length,
      newLeads: rawNewLeads,
      tenantLeads: savedTenantLeads,
      districtCounts,
      totalLeads: currentTotal,
      license: updatedLicense,
      areaPotential: {
        locationLabel,
        estimatedTotal,
        extractedCount: rawNewLeads.length,
        keyLimit: maxQuota,
        remainingQuota: remAfter,
        planLabel: updatedLicense ? updatedLicense.planLabel : (req.license.planLabel || 'Key Hiện Tại'),
        quotaBadge: updatedLicense ? updatedLicense.quotaBadge : (req.license.quotaBadge || `${maxQuota} Leads`),
        isUnlimited: isUnlimitedKey,
        remainingCount: Math.max(0, estimatedTotal - Math.max(rawNewLeads.length, savedTenantLeads.length)),
        showUpgradePopup: shouldSuggestUpgrade
      },
      paymentInfo
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
      db.licenseManager.recordUsage(tenantKey, leads.length, req.deviceId, req.deviceInfo, req.clientIp);
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

// 8. POST /api/zalo/check - Bulk Check Zalo status (Active vs Not Found)
app.post('/api/zalo/check', requireLicense, async (req, res) => {
  try {
    const { phones } = req.body;
    const tenantKey = req.license.key;
    let targetPhones = [];

    if (phones && Array.isArray(phones) && phones.length > 0) {
      targetPhones = phones;
    } else {
      const tenantLeads = db.getAll(tenantKey);
      targetPhones = tenantLeads.map(l => l.phone);
    }

    console.log(`[API /zalo/check] [Tenant: ${tenantKey}] Kiểm tra trạng thái Zalo (Active vs Not Found) cho ${targetPhones.length} SĐT...`);
    const results = await zaloChecker.checkBatch(targetPhones);

    let activeCount = 0;
    let notFoundCount = 0;
    for (const r of results) {
      db.updateZaloStatus(r.phone, r.zaloActive ? 1 : 0, r.zaloName || '', r.zaloAvatar || '', tenantKey);
      if (r.zaloActive) activeCount++;
      else notFoundCount++;
    }

    res.json({
      success: true,
      message: `Đã kiểm tra xong ${results.length} số: ${activeCount} số Đã đăng ký Zalo (ACTIVE), ${notFoundCount} số Chưa đăng ký (NOT FOUND)!`,
      activeCount,
      notFoundCount,
      results: results
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 8.1 POST /api/zalo/check-import - Import Bulk Phone List (.txt/.csv/paste) to Check Zalo Active vs Not Found
app.post('/api/zalo/check-import', requireLicense, async (req, res) => {
  try {
    const { phones = [], saveToLeads = false, defaultIndustry = 'Tệp SĐT Import', defaultCity = 'Toàn quốc' } = req.body;
    const tenantKey = req.license.key;

    const cleanList = Array.from(new Set(
      (Array.isArray(phones) ? phones : String(phones).split(/[\r\n,;|\t]+/))
        .map(p => zaloChecker.normalizePhone(p))
        .filter(p => p.length >= 9 && p.length <= 11)
    )).slice(0, 1000);

    if (cleanList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Không tìm thấy số điện thoại hợp lệ trong danh sách tải lên!'
      });
    }

    const results = await zaloChecker.checkBatch(cleanList);
    let activeCount = 0;
    let notFoundCount = 0;
    const importedLeads = [];

    for (const r of results) {
      if (r.zaloActive) activeCount++;
      else notFoundCount++;

      if (saveToLeads) {
        importedLeads.push({
          id: `IMP-${r.phone}`,
          company: r.zaloName ? `KH Zalo: ${r.zaloName}` : `Khách Hàng SĐT ${r.phone}`,
          contactName: r.zaloName || 'Khách hàng Import',
          role: 'Cá nhân / Doanh nghiệp',
          phone: r.phone,
          carrier: r.carrier,
          email: '',
          city: defaultCity,
          address: defaultCity,
          industry: defaultIndustry,
          taxCode: '',
          website: '',
          status: 'Đã xác thực',
          zaloActive: r.zaloActive,
          zaloStatus: r.status,
          zaloName: r.zaloName || '',
          zaloAvatar: r.zaloAvatar || '',
          source: 'Import SĐT Check Zalo',
          sourceUrl: `https://zalo.me/${r.phone}`,
          snippet: `Trạng thái Zalo: ${r.status} (${r.reason})`,
          verifiedAt: new Date().toISOString().split('T')[0],
          crmStatus: 'new',
          crmNote: ''
        });
      }
    }

    if (saveToLeads && importedLeads.length > 0) {
      db.batchAdd(importedLeads, tenantKey);
    }

    res.json({
      success: true,
      message: `Kiểm tra hoàn tất ${results.length} SĐT: ${activeCount} số ACTIVE (Có Zalo) • ${notFoundCount} số NOT FOUND!`,
      totalChecked: results.length,
      activeCount,
      notFoundCount,
      results,
      savedCount: importedLeads.length
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 8.2 PUT /api/leads/:id/crm - Update Mini-CRM status & note
app.put('/api/leads/:id/crm', requireLicense, (req, res) => {
  try {
    const { id } = req.params;
    const { crmStatus, crmNote } = req.body;
    const tenantKey = req.license.key;
    const ok = db.updateLeadCrm(id, { crmStatus, crmNote }, tenantKey);
    res.json({
      success: true,
      updated: ok,
      message: 'Đã lưu trạng thái chăm sóc khách hàng!'
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
      return res.status(400).json({ success: false, message: 'Tên công ty và số điện thoại là bắt buộc!' });
    }

    let normPhone = zaloChecker.normalizePhone(phone);
    const carrier = zaloChecker.getCarrier(normPhone);
    const zaloRes = await zaloChecker.checkPhone(normPhone);

    const newLead = {
      id: `LD-${Date.now().toString().slice(-6)}`,
      company: company.trim(),
      contactName: contactName ? contactName.trim() : 'Chủ doanh nghiệp',
      role: role ? role.trim() : 'Giám đốc điều hành',
      phone: normPhone,
      carrier: carrier,
      email: email ? email.trim() : '',
      city: city || 'Toàn quốc',
      address: address ? address.trim() : 'Việt Nam',
      industry: industry || 'Chung',
      taxCode: taxCode || '',
      website: website || '',
      status: 'Đã xác thực',
      zaloActive: zaloRes.zaloActive,
      zaloStatus: zaloRes.status,
      zaloName: zaloRes.zaloName || contactName || company,
      zaloAvatar: zaloRes.zaloAvatar || '',
      verifiedAt: new Date().toISOString().split('T')[0],
      source: 'Thủ công (Người dùng)',
      sourceUrl: `https://zalo.me/${normPhone}`,
      crmStatus: 'new',
      crmNote: ''
    };

    db.add(newLead, tenantKey);

    res.json({
      success: true,
      message: 'Thêm khách hàng thành công!',
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
    if (!ok) return res.status(404).json({ success: false, message: 'Không tìm thấy dữ liệu cần xóa!' });

    res.json({
      success: true,
      message: 'Đã xóa lead thành công!',
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
      message: 'Đã làm sạch toàn bộ kho dữ liệu leads của bạn!',
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
  const currentPassword = process.env.ADMIN_PASSWORD || db.licenseManager.getSetting('adminPassword') || 'admindev5s';

  if (password && (password === currentPassword || db.licenseManager.isMasterKey(password))) {
    res.json({ success: true, message: 'Đăng nhập Admin thành công!', token: 'ADMIN5S' });
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

// 16. PUT /api/admin/licenses/:key - Update license
app.put('/api/admin/licenses/:key', requireAdmin, (req, res) => {
  try {
    const { key } = req.params;
    const ok = db.licenseManager.updateLicense(key, req.body);
    if (!ok) return res.status(404).json({ success: false, message: 'Không tìm thấy key!' });

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
    db.licenseManager.deleteLicense(key);
    res.json({ success: true, message: 'Đã xóa License Key thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 17.1. GET /api/admin/licenses/:key/logs
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

// 17.2. POST /api/admin/licenses/:key/reset-device
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

// 19. POST /api/admin/settings
app.post('/api/admin/settings', requireAdmin, (req, res) => {
  try {
    db.licenseManager.setSettings(req.body);
    res.json({ success: true, message: 'Đã lưu cấu hình hệ thống thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 19.1 GET /api/admin/backup - Export full JSON backup of Licenses & Settings
app.get('/api/admin/backup', requireAdmin, (req, res) => {
  try {
    const backup = db.licenseManager.exportBackupData();
    res.json({
      success: true,
      backup
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 19.2 POST /api/admin/restore - Restore Licenses & Settings from JSON backup
app.post('/api/admin/restore', requireAdmin, (req, res) => {
  try {
    const payload = req.body.backup || req.body;
    const result = db.licenseManager.importBackupData(payload);
    res.json({
      success: true,
      message: `Đã khôi phục thành công ${result.importedLicenses} License Keys và toàn bộ cấu hình hệ thống!`,
      ...result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 20. POST /api/admin/zalo/session
app.post('/api/admin/zalo/session', requireAdmin, (req, res) => {
  try {
    const { cookie, accountInfo, apiKey, apiUrl, zaloCookie, zaloApiKey, zaloApiUrl, goongApiKey } = req.body;
    const finalCookie = cookie !== undefined ? cookie : zaloCookie;
    const finalApiKey = apiKey !== undefined ? apiKey : zaloApiKey;
    const finalApiUrl = apiUrl !== undefined ? apiUrl : zaloApiUrl;

    if (finalCookie !== undefined) {
      if (finalCookie) zaloChecker.saveSession(finalCookie, accountInfo || {});
      db.licenseManager.setSetting('zaloCookie', finalCookie || '');
    }
    if (finalApiKey !== undefined) db.licenseManager.setSetting('zaloApiKey', finalApiKey || '');
    if (finalApiUrl !== undefined) db.licenseManager.setSetting('zaloApiUrl', finalApiUrl || '');
    if (goongApiKey !== undefined) db.licenseManager.setSetting('goongApiKey', goongApiKey || '');

    res.json({ success: true, message: 'Đã lưu cấu hình kết nối API & Cookie Zalo thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 21. POST /api/admin/zalo/test
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

// 22. GET /api/admin/zalo/session-status
app.get('/api/admin/zalo/session-status', requireAdmin, async (req, res) => {
  try {
    const cookie = db.licenseManager.getSetting('zaloCookie');
    const status = await zaloChecker.checkSessionStatus(cookie);
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    const masterKey = (process.env.ADMIN_MASTER_KEY || 'ADMIN-DEV5S-2026').trim().toUpperCase();
    console.log(`=======================================================`);
    console.log(`🚀 Nền Tảng SaaS Quét Lead B2B (Phiên Bản Thương Mại V5.5)`);
    console.log(`📡 Server: http://localhost:${PORT}`);
    console.log(`🔑 Master Key Admin: ${masterKey}`);
    console.log(`🛡️  Mật Khẩu Admin: ${process.env.ADMIN_PASSWORD || db.licenseManager.getSetting('adminPassword') || 'admin888'}`);
    console.log(`💾 SQLite DB: leads.db (Multi-Tenancy & 63 Tỉnh Thành Active)`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
