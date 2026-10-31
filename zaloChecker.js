const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSION_FILE = path.join(__dirname, 'zalo_session.json');

const CARRIERS = {
  viettel: ['086', '096', '097', '098', '032', '033', '034', '035', '036', '037', '038', '039'],
  vinaphone: ['088', '091', '094', '081', '082', '083', '084', '085'],
  mobifone: ['089', '090', '093', '070', '076', '077', '078', '079'],
  vietnamobile: ['092', '052', '056', '058'],
  gmobile: ['099', '059'],
  itelecom: ['087'],
  wintel: ['055']
};

class ZaloChecker {
  constructor() {
    this.sessionCookie = this.loadSession();
    this.externalApiKey = process.env.ZALO_CHECK_API_KEY || null;
    this.externalApiUrl = null;
    this.dbGetter = null;
    this._zcaClient = null;
    this._lastCookie = null;
  }

  setDbGetter(fn) {
    this.dbGetter = fn;
  }

  loadSession() {
    try {
      if (fs.existsSync(SESSION_FILE)) {
        const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
        return data.cookie || null;
      }
    } catch (e) {
      console.warn('[Zalo] Could not load session file:', e.message);
    }
    return null;
  }

  saveSession(cookie, accountInfo = {}) {
    try {
      this.sessionCookie = cookie;
      this._zcaClient = null;
      const data = {
        cookie,
        accountInfo,
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), 'utf-8');
      console.log('[Zalo] Saved active Zalo Web session!');
      return true;
    } catch (e) {
      console.error('[Zalo] Save session error:', e.message);
      return false;
    }
  }

  hasActiveSession() {
    const cookie = this.sessionCookie || (this.dbGetter ? this.dbGetter('zaloCookie') : null);
    return !!cookie;
  }

  getCarrier(phone) {
    if (!phone || typeof phone !== 'string') return 'Khác';
    const clean = phone.replace(/[^0-9]/g, '');
    if (clean.length !== 10) return 'Cố định / Khác';
    const prefix3 = clean.slice(0, 3);
    for (const [carrier, prefixes] of Object.entries(CARRIERS)) {
      if (prefixes.includes(prefix3)) {
        return carrier.toUpperCase();
      }
    }
    return 'Cố định / Khác';
  }

  isValidMobile(phone) {
    if (!phone || typeof phone !== 'string') return false;
    const clean = phone.replace(/[^0-9]/g, '');
    if (clean.length !== 10) return false;
    const prefix3 = clean.slice(0, 3);
    for (const prefixes of Object.values(CARRIERS)) {
      if (prefixes.includes(prefix3)) return true;
    }
    return false;
  }

  // Live session health check on Zalo Web Server
  async checkSessionStatus(rawCookie = null) {
    const raw = rawCookie || this.sessionCookie || (this.dbGetter ? this.dbGetter('zaloCookie') : null);
    if (!raw || !raw.trim()) {
      return { status: 'EMPTY', valid: false, message: 'Chưa cấu hình Cookie zpw_sek' };
    }

    let cookie = raw.trim();
    if (!cookie.includes('zpw_sek=') && !cookie.includes(';')) {
      cookie = `zpw_sek=${cookie}`;
    }
    if (!cookie.includes('zpw_type=')) {
      cookie = `${cookie}; zpw_type=30`;
    }

    return new Promise((resolve) => {
      const options = {
        hostname: 'wpa.chat.zalo.me',
        port: 443,
        path: '/api/login/getLoginInfo',
        method: 'GET',
        headers: {
          'Cookie': cookie,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://chat.zalo.me/',
          'Origin': 'https://chat.zalo.me'
        },
        timeout: 4000
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (json.error_code === 0) {
              resolve({
                status: 'LIVE',
                valid: true,
                message: 'Cookie đang hoạt động tốt (Kết nối máy chủ Zalo OK)'
              });
            } else if (json.error_code === 102) {
              resolve({
                status: 'EXPIRED',
                valid: false,
                errorCode: 102,
                message: 'Cookie đã hết hạn phiên làm việc (Zalo báo Lỗi 102: Session timeout). Vui lòng F5 tab chat.zalo.me và copy lại chuỗi zpw_sek mới.'
              });
            } else {
              resolve({
                status: 'INVALID',
                valid: false,
                errorCode: json.error_code,
                message: json.error_message || `Lỗi xác thực Zalo (Mã ${json.error_code})`
              });
            }
          } catch (e) {
            resolve({ status: 'ERROR', valid: false, message: 'Không thể phân tích phản hồi từ Zalo' });
          }
        });
      });

      req.on('error', (err) => resolve({ status: 'ERROR', valid: false, message: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT', valid: false, message: 'Hết thời gian kết nối Zalo' }); });
      req.end();
    });
  }

  // Real Zalo Web query via zca-js or internal API
  async queryZaloWebInternal(phone, customCookie = null) {
    const rawCookie = customCookie || this.sessionCookie || (this.dbGetter ? this.dbGetter('zaloCookie') : null);
    if (!rawCookie || !rawCookie.trim()) return null;

    // Check session health first
    const sessionHealth = await this.checkSessionStatus(rawCookie);
    if (!sessionHealth.valid) {
      return {
        sessionError: true,
        sessionStatus: sessionHealth.status,
        errorCode: sessionHealth.errorCode,
        reason: sessionHealth.message
      };
    }

    // Extract raw zpw_sek value
    let sekVal = rawCookie.trim();
    if (sekVal.includes('zpw_sek=')) {
      const match = sekVal.match(/zpw_sek=([^;]+)/);
      if (match) sekVal = match[1];
    }

    try {
      const { Zalo } = await import('zca-js');
      const zalo = new Zalo({ logging: false });
      const cookies = [{
        name: 'zpw_sek',
        value: sekVal,
        domain: 'chat.zalo.me',
        path: '/'
      }];
      const imei = crypto.randomUUID();
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

      const api = await zalo.login({
        cookie: cookies,
        imei,
        userAgent
      });

      let formattedPhone = phone;
      if (formattedPhone.startsWith('0')) formattedPhone = '84' + formattedPhone.slice(1);

      const user = await api.findUser(formattedPhone);
      if (user && user.uid) {
        return {
          zaloActive: true,
          zaloName: user.displayName || user.zaloName || user.name || '',
          zaloAvatar: user.avatar || '',
          reason: 'Tìm thấy tài khoản Zalo'
        };
      } else {
        return {
          zaloActive: false,
          zaloName: '',
          zaloAvatar: '',
          reason: 'Tài khoản không tồn tại hoặc không cho phép tìm kiếm qua SĐT'
        };
      }
    } catch (err) {
      if (err.code === 216 || (err.message && err.message.includes('216'))) {
        return {
          zaloActive: false,
          zaloName: '',
          zaloAvatar: '',
          reason: 'Tài khoản không tồn tại hoặc chặn tìm kiếm'
        };
      }
      console.warn('[Zalo] Query Zalo Web error:', err.message);
      return null;
    }
  }

  // 3rd party API checker (Hỗ trợ tất cả cổng Check Zalo tại VN: CheckNumber, GeekNums, SoloZ, DichvuAPI, v.v.)
  async queryExternalGateway(phone, apiKey, customUrl = null) {
    const rawKey = apiKey || this.externalApiKey || (this.dbGetter ? this.dbGetter('zaloApiKey') : null);
    if (!rawKey || !rawKey.trim()) return null;

    const endpoint = customUrl || this.externalApiUrl || (this.dbGetter ? this.dbGetter('zaloApiUrl') : null) || 'https://api.checkzalo.vn/v1/check';
    let parsedUrl = null;
    try {
      parsedUrl = new URL(endpoint);
    } catch (e) {
      console.warn('[Zalo] Invalid Gateway URL:', endpoint);
      return null;
    }

    return new Promise((resolve) => {
      const cleanPhone = phone.replace(/[^0-9]/g, '');
      const postData = JSON.stringify({ 
        phone: cleanPhone, 
        sdt: cleanPhone,
        api_key: rawKey.trim(),
        apiKey: rawKey.trim(),
        token: rawKey.trim()
      });

      const isHttps = parsedUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${rawKey.trim()}`,
          'api-key': rawKey.trim(),
          'token': rawKey.trim(),
          'User-Agent': 'LeadExtractorPro/5.0',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 6000
      };

      const req = transport.request(options, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try {
            const data = JSON.parse(d);
            // Hỗ trợ phổ quát tất cả các kiểu định dạng JSON trả về của thị trường
            const isActive = !!(
              data.has_zalo === true || data.has_zalo === 1 || data.has_zalo === '1' ||
              data.hasZalo === true || data.hasZalo === 1 ||
              data.is_zalo === true || data.is_zalo === 1 ||
              data.exist === true || data.exists === true ||
              data.active === true || data.status === 'active' || data.status === 'success' || data.status === 1 || data.status === 200 ||
              data.data?.has_zalo || data.data?.hasZalo || data.data?.is_zalo || data.data?.exist || data.data?.exists || data.data?.active ||
              (data.data && data.data.status === 1) ||
              data.result?.has_zalo || data.result?.hasZalo || data.result?.exist ||
              data.user?.zaloActive || data.user?.name
            );

            const name = data.name || data.display_name || data.displayName || data.fullname || data.full_name || 
                         data.data?.name || data.data?.displayName || data.data?.display_name || data.data?.fullname ||
                         data.user?.name || data.user?.displayName || '';

            const avatar = data.avatar || data.avatar_url || data.avatarUrl || data.picture ||
                           data.data?.avatar || data.data?.avatar_url || data.data?.avatarUrl || 
                           data.user?.avatar || '';

            resolve({
              zaloActive: isActive,
              zaloName: name,
              zaloAvatar: avatar,
              reason: isActive ? 'Đã tìm thấy tài khoản Zalo' : 'Tài khoản không tồn tại'
            });
          } catch (e) {
            console.warn('[Zalo] JSON parse error from Gateway response:', e.message);
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        console.warn('[Zalo] External Gateway Request Error:', err.message);
        resolve(null);
      });
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.write(postData);
      req.end();
    });
  }

  // Check a single phone number with all available engines
  async checkPhone(phone, customApiKey = null, customCookie = null, customApiUrl = null) {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const carrier = this.getCarrier(cleanPhone);
    const isMobile = this.isValidMobile(cleanPhone);

    if (!isMobile) {
      return {
        phone: cleanPhone,
        carrier: 'Số cố định/Tổng đài',
        zaloActive: false,
        reason: 'Không phải thuê bao di động',
        zaloName: '',
        zaloAvatar: '',
        zaloLink: `https://zalo.me/${cleanPhone}`,
        verified: true
      };
    }

    const currentCookie = customCookie || this.sessionCookie || (this.dbGetter ? this.dbGetter('zaloCookie') : null);
    const currentApiKey = customApiKey || this.externalApiKey || (this.dbGetter ? this.dbGetter('zaloApiKey') : null);

    // Ưu tiên 1: 3rd Party API Key nếu được cấu hình (API Key là vĩnh viễn, cực kỳ ổn định cho bản bán thương mại)
    if (currentApiKey && currentApiKey.trim()) {
      try {
        const extResult = await this.queryExternalGateway(cleanPhone, currentApiKey, customApiUrl);
        if (extResult !== null) {
          return {
            phone: cleanPhone,
            carrier,
            zaloActive: extResult.zaloActive,
            zaloName: extResult.zaloName || '',
            zaloAvatar: extResult.zaloAvatar || '',
            reason: extResult.reason || (extResult.zaloActive ? 'Tìm thấy tài khoản Zalo' : 'Tài khoản không tồn tại'),
            zaloLink: `https://zalo.me/${cleanPhone}`,
            verified: true,
            source: 'Zalo Gateway API (Vĩnh viễn)'
          };
        }
      } catch (err) {
        console.warn('[Zalo] External API check error:', err.message);
      }
    }

    // Ưu tiên 2: Zalo Web Session Cookie (Miễn phí qua zca-js)
    if (currentCookie && currentCookie.trim()) {
      try {
        const webResult = await this.queryZaloWebInternal(cleanPhone, currentCookie);
        if (webResult !== null) {
          if (webResult.sessionError) {
            // Nếu không có API Key thì mới trả sessionError để nhắc người dùng
            if (!currentApiKey || !currentApiKey.trim()) {
              return {
                phone: cleanPhone,
                carrier,
                zaloActive: false,
                sessionError: true,
                sessionStatus: webResult.sessionStatus,
                errorCode: webResult.errorCode,
                reason: webResult.reason,
                zaloName: '',
                zaloAvatar: '',
                zaloLink: `https://zalo.me/${cleanPhone}`,
                verified: false
              };
            }
          } else {
            return {
              phone: cleanPhone,
              carrier,
              zaloActive: webResult.zaloActive,
              zaloName: webResult.zaloName || '',
              zaloAvatar: webResult.zaloAvatar || '',
              reason: webResult.reason || (webResult.zaloActive ? 'Tìm thấy tài khoản Zalo' : 'Tài khoản không tồn tại'),
              zaloLink: `https://zalo.me/${cleanPhone}`,
              verified: true,
              source: 'Zalo Web Session (Thật 100%)'
            };
          }
        }
      } catch (err) {
        console.warn('[Zalo] Web session check error:', err.message);
      }
    }

    // Engine 3: Chưa cấu hình kết nối hợp lệ
    return {
      phone: cleanPhone,
      carrier,
      zaloActive: false,
      sessionError: true,
      sessionStatus: 'NOT_CONFIGURED',
      reason: 'Chưa có cấu hình Zalo hợp lệ hoặc Cookie zpw_sek đã hết hạn. Vui lòng kiểm tra lại cấu hình Zalo.',
      zaloName: '',
      zaloAvatar: '',
      zaloLink: `https://zalo.me/${cleanPhone}`,
      verified: false,
      source: 'Chưa xác thực'
    };
  }

  async checkBatch(phones, customApiKey = null, customCookie = null, customApiUrl = null) {
    const results = [];
    for (const phone of phones) {
      const res = await this.checkPhone(phone, customApiKey, customCookie, customApiUrl);
      results.push(res);
    }
    return results;
  }
}

module.exports = new ZaloChecker();
