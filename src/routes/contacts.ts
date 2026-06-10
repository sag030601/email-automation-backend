import { Router } from 'express'
import {
  getContacts,
  createContact,
  updateContact,
  deleteContact,
} from '../controllers/contactController.js'
import { authenticate } from '../middleware/auth.js'
import { loadTenant } from '../middleware/tenant.js'

const router = Router()

router.use(authenticate)
router.use(loadTenant)

router.get('/', getContacts)
router.post('/', createContact)
router.put('/:id', updateContact)
router.delete('/:id', deleteContact)

export default router
