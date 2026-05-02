import { Router, type IRouter } from "express";
import healthRouter from "./health";
import transactionsRouter from "./transactions";
import dashboardRouter from "./dashboard";
import aiRouter from "./ai";
import scenariosRouter from "./scenarios";
import budgetRouter from "./budget";
import netWorthRouter from "./net-worth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(transactionsRouter);
router.use(dashboardRouter);
router.use(aiRouter);
router.use(scenariosRouter);
router.use(budgetRouter);
router.use(netWorthRouter);

export default router;
