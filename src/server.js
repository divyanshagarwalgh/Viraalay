'use strict';

const app = require('./app');
const { config } = require('./config');

app.listen(config.port, () => {
  console.log(`Viraalay booking engine listening on http://localhost:${config.port}`);
  console.log(`Public base URL: ${config.publicBaseUrl}`);
  console.log(`Script tag: <script defer src="${config.publicBaseUrl}/assets/viraalay-booking.js"></script>`);
});
