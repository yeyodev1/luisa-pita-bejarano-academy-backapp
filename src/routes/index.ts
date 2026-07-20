import express, { Application } from "express";
import authRouter from "./auth.routes";
import paymentRouter from "./payment.routes";
import presaleRouter from "./presale.routes";
import adminRouter from "./admin.routes";
import launchReminderRouter from "./launchReminder.routes";
import pixelRouter from "./pixel.routes";
import academyRouter from "./academy.routes";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);

  router.use("/auth", authRouter);
  router.use("/payments", paymentRouter);
  router.use("/presale", presaleRouter);
  router.use("/admin", adminRouter);
  router.use("/launch-reminders", launchReminderRouter);
  router.use("/pixel", pixelRouter);
  router.use("/academy", academyRouter);
}

export default routerApi;
