import { Router } from "express";
import {
  login,
  logout,
  me,
  refresh,
  register,
} from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.post("/refresh", refresh);

// The only authenticated route on this router. Method and path both differ
// from the four POSTs above, so ordering here is not load-bearing.
router.get("/me", requireAuth, me);

export default router;
