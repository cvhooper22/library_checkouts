const { createApp } = require('./app');

const PORT = process.env.PORT || 7776;

createApp().listen(PORT, () => {
  console.log(`[api] listening on port ${PORT}`);
});
