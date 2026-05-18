import { Router } from 'express'
import {
  getSubscription,
  createCheckout,
  createPortal,
} from '../controllers/billingController.js'
import { authenticate } from '../middleware/auth.js'
import { loadTenant } from '../middleware/tenant.js'

const router = Router()

router.use(authenticate)
router.use(loadTenant)

router.get('/subscription', getSubscription)
router.post('/create-checkout-session', createCheckout)
router.post('/create-portal-session', createPortal)

export default router
