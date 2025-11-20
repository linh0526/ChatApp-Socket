const DEFAULT_STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:3478' },
  { urls: 'stun:stun2.l.google.com:3478' },
];

const buildTurnServers = () => {
  const urlsValue = process.env.TURN_URLS || '';
  const username = process.env.TURN_USERNAME || '';
  const credential = process.env.TURN_CREDENTIAL || '';

  if (!urlsValue) {
    return [];
  }

  return urlsValue
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => {
      const server = { urls: url };
      if (username) {
        server.username = username;
      }
      if (credential) {
        server.credential = credential;
      }
      return server;
    });
};

exports.getIceServers = (req, res) => {
  try {
    const turnServers = buildTurnServers();
    const iceServers = [...DEFAULT_STUN_SERVERS, ...turnServers];
    return res.json({ iceServers });
  } catch (error) {
    console.error('getIceServers error:', error);
    return res.status(500).json({ error: 'Không thể tải cấu hình ICE server' });
  }
};

