import express from 'express';


import { notFoundHandler } from "./middleware/notFoundHandler.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

app.use(express.json({ limit: '100kb' }));


app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// 404 MUST come after all routes.
app.use(notFoundHandler);

// Error handler MUST be last.
app.use(errorHandler);

export default app;