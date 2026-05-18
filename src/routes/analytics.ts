import { Router } from 'express'
import {
  getDashboardStats,
  getChartData,
  getCampaignAnalytics,
} from '../controllers/analyticsController.js'
import { authenticate } from '../middleware/auth.js'
import { loadTenant } from '../middleware/tenant.js'

const router = Router()

router.use(authenticate)
router.use(loadTenant)

router.get('/dashboard', getDashboardStats)
router.get('/chart', getChartData)
router.get('/campaigns/:id', getCampaignAnalytics)

export default router
