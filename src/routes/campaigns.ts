import { Router } from 'express'
import {
  getCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaign,
  pauseCampaign,
  duplicateCampaign,
  getCampaignQueueStatus,
} from '../controllers/campaignController.js'
import { authenticate } from '../middleware/auth.js'
import { loadTenant, checkEmailLimit } from '../middleware/tenant.js'

const router = Router()

router.use(authenticate)
router.use(loadTenant)

router.get('/', getCampaigns)
router.get('/queue-status', getCampaignQueueStatus)
router.get('/:id', getCampaign)
router.post('/', createCampaign)
router.put('/:id', updateCampaign)
router.delete('/:id', deleteCampaign)
router.post('/:id/send', checkEmailLimit, sendCampaign)
router.post('/:id/pause', pauseCampaign)
router.post('/:id/duplicate', duplicateCampaign)

export default router
