require('colors');
const WebSocket = require('ws');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const NodePersist = require('node-persist');
const BrowserID_Cache = NodePersist.create();
BrowserID_Cache.init();

class Bot {
  constructor(config) {
    this.config = config;
  }

  async getProxyIP(proxy) {
    const agent = proxy.startsWith('http')
      ? new HttpsProxyAgent(proxy)
      : new SocksProxyAgent(proxy);
    try {
      const response = await axios.get(this.config.ipCheckURL, {
        httpsAgent: agent,
        headers: {
          'Accept-Encoding': 'gzip'
        }
      });
      console.log(`Đã kết nối proxy ${proxy.replace(proxy.match(/^(https?\:\/\/|socks5:\/\/)?.*?\:(.*?)\@.*$/i)[2], '***')}`.green);
      return response.data;
    } catch (error) {
      console.error(
        `Bỏ qua proxy ${proxy.replace(proxy.match(/^(https?\:\/\/|socks5:\/\/)?.*?\:(.*?)\@.*$/i)[2], '***')} do lỗi kết nối: ${error.message}`
          .yellow
      );

      if(error.code == 'ECONNRESET') {
        console.warn(`Mã Lỗi ECONNRESET, đang thử lại sau 60 giây!`.yellow);
        await new Promise(r => setTimeout(r, 60*1000));
        return this.getProxyIP(proxy);
      }

      if(error.status == 502) {
        console.warn(`Mã lỗi 502, thử lại sau 10 phút!`.yellow);
        return {retry502: true};
      }

      return null;
    }
  }

  async connectToProxy(proxy, userID) {
    const _proxy = proxy.replace(/^http:\/\/|socks5:\/\//i, '');
    const formattedProxy = proxy.startsWith('socks5://')
      ? proxy
      : proxy.startsWith('http')
      ? proxy
      : `socks5://${proxy}`;
    const proxyInfo = await this.getProxyIP(formattedProxy);

    if(proxyInfo?.retry502 == true) {
      return setTimeout(() =>this.connectToProxy(proxy, userID), 10*60*1000);
    }

    if (!proxyInfo) {
      return;
    }

    try {
      const agent = formattedProxy.startsWith('http')
        ? new HttpsProxyAgent(formattedProxy, {keepAlive: true})
        : new SocksProxyAgent(formattedProxy, {keepAlive: true});
      const wsURL = `wss://${this.config.wssHost}`;
      const ws = new WebSocket(wsURL, {
        agent,
        headers: {
          "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
        }
      });

      ws.on('open', () => {
        console.log(`Proxy ${proxyInfo.ip} - ${proxyInfo.city} (${proxyInfo.country})`.magenta);
        this._sendPing = this.sendPing(ws, proxyInfo.ip);
      });

      ws.on('message', async (message) => {
        const msg = JSON.parse(message);
        
        if (msg.action === 'AUTH') {
          console.log(`Nhận auth với id: ${msg.id}`.blue);
          const authResponse = {
            id: msg.id,
            origin_action: 'AUTH',
            result: {
              browser_id: await BrowserID_Cache.getItem(_proxy) || (await BrowserID_Cache.setItem(_proxy, uuidv4()), await BrowserID_Cache.getItem(_proxy)),
              user_id: userID,
              user_agent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
              timestamp: Math.floor(Date.now() / 1000),
              device_type: 'desktop, Linux, x86_64, Safari, 17.0',
              version: '4.28.1',
            },
          };
          ws.send(JSON.stringify(authResponse));
          console.log(`Gửi yêu cầu đăng nhập`.green);
        } else if (msg.action === 'PONG') {
          console.log(`Server trả về PONG id: ${msg.id}`.blue);
        }
      });

      ws.on('close', (code, reason) => {
        console.log(
          `Ngắt kết nối với mã: ${code}, reason: ${reason}`.yellow
        );

        clearInterval(this._sendPing);

        this.connectToProxy(proxy, userID);
      });

      ws.on('error', (error) => {
        console.error(
          `Lỗi WebSocket ${proxy}: ${error.message}`.red
        );
        ws.terminate();
      });
    } catch (error) {
      console.error(
        `Không thể đăng nhập với proxy ${proxy}: ${error.message}`.red
      );
    }
  }

  async connectDirectly(userID) {
    try {
      const wsURL = `wss://${this.config.wssHost}`;
      const ws = new WebSocket(wsURL, {
        headers: {
          "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
        }
      });

      ws.on('open', () => {
        console.log(`Kết nối không cần proxy`.cyan);
        this._sendPing = this.sendPing(ws, 'Direct IP');
      });

      ws.on('message', async (message) => {
        const msg = JSON.parse(message);
        
        if (msg.action === 'AUTH') {
          console.log(`Nhận auth với id: ${msg.id}`.blue);
          const authResponse = {
            id: msg.id,
            origin_action: 'AUTH',
            result: {
              browser_id: await BrowserID_Cache.getItem('default') || (await BrowserID_Cache.setItem('default', uuidv4()), await BrowserID_Cache.getItem('default')),
              user_id: userID,
              user_agent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
              timestamp: Math.floor(Date.now() / 1000),
              device_type: 'desktop, Linux, x86_64, Safari, 17.0',
              version: '4.28.1',
            },
          };
          ws.send(JSON.stringify(authResponse));
          console.log(`Gửi yêu cầu đăng nhập`.green);
        } else if (msg.action === 'PONG') {
          console.log(`Server trả về PONG id: ${msg.id}`.blue);
        }
      });

      ws.on('close', (code, reason) => {
        console.log(
          `Ngắt kết nối: ${code}, reason: ${reason}`.yellow
        );

        clearInterval(this._sendPing);

        this.connectDirectly(userID);
      });

      ws.on('error', (error) => {
        console.error(`Lỗi rồi: ${error.message}`.red);
        ws.terminate();
      });
    } catch (error) {
      console.error(`Không thể đăng nhập: ${error.message}`.red);
    }
  }

  sendPing(ws, proxyIP) {
    return setInterval(() => {
      const pingId = uuidv4();
      const pingMessage = {
        id: pingId,
        version: '1.0.0',
        action: 'PING',
        data: {},
      };
      ws.send(JSON.stringify(pingMessage));
      console.log(
        `Gửi Ping tới server với id ${pingId} | ip: ${proxyIP}`.cyan
      );
    }, 2 * 60 * 1000);
  }
}

module.exports = Bot;
