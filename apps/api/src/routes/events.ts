import { Router } from "express";

import { requireAuth } from "../middleware/auth.js";
import { create } from "../controllers/eventController.js";

const router = Router();

router.post("/", requireAuth, create,);

export default router;