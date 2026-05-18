import { Router } from 'express'
import { register, login, me, refreshToken, updateProfile, changePassword } from '../controllers/authController.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()

router.post('/register', register)
router.post('/login', login)
router.get('/me', authenticate, me)
router.post('/refresh', authenticate, refreshToken)
router.put('/profile', authenticate, updateProfile)
router.put('/password', authenticate, changePassword)

export default router
