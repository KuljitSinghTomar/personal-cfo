import { Router, type IRouter } from "express";
import healthRouter from "./health";
import transactionsRouter from "./transactions";
import dashboardRouter from "./dashboard";
import aiRouter from "./ai";
import scenariosRouter from "./scenarios";
import budgetRouter from "./budget";
import netWorthRouter from "./net-worth";
import categoryRulesRouter from "./category-rules";
import investmentsRouter from "./investments";
import accountsRouter from "./accounts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(transactionsRouter);
router.use(dashboardRouter);
router.use(aiRouter);
router.use(scenariosRouter);
router.use(budgetRouter);
router.use(netWorthRouter);
router.use(categoryRulesRouter);
router.use(investmentsRouter);
router.use(accountsRouter);

export default router;
