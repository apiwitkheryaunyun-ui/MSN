const express = require('express');
const router = express.Router();
const auth = require('../middleware');

router.get('/webrtc', auth, async (_req, res) => {
  return res.json({
    ok: true,
    webrtc: {
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302'] },
      ],
    },
  });
});

module.exports = router;