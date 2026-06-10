import { Response } from 'express'
import Campaign from '../models/Campaign.js'
import EmailEvent from '../models/EmailEvent.js'
import { TenantRequest } from '../middleware/tenant.js'
import logger from '../utils/logger.js'

export const getDashboardStats = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const tenantId = req.user.tenantId

    const campaigns = await Campaign.find({ tenantId })
    const totalCampaigns = campaigns.length

    const stats = campaigns.reduce(
      (acc, campaign) => ({
        totalSent: acc.totalSent + campaign.stats.sent,
        totalOpened: acc.totalOpened + campaign.stats.opened,
        totalClicked: acc.totalClicked + campaign.stats.clicked,
      }),
      { totalSent: 0, totalOpened: 0, totalClicked: 0 }
    )

    const openRate = stats.totalSent > 0 ? (stats.totalOpened / stats.totalSent) * 100 : 0
    const clickRate = stats.totalSent > 0 ? (stats.totalClicked / stats.totalSent) * 100 : 0

    res.json({
      totalCampaigns,
      totalSent: stats.totalSent,
      totalOpened: stats.totalOpened,
      totalClicked: stats.totalClicked,
      openRate,
      clickRate,
    })
  } catch (error) {
    logger.error('Get dashboard stats error:', error)
    res.status(500).json({ error: 'Failed to fetch dashboard stats' })
  }
}

export const getChartData = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const tenantId = req.user.tenantId
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const events = await EmailEvent.aggregate([
      {
        $match: {
          tenantId: tenantId,
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            type: '$type',
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { '_id.date': 1 },
      },
    ])

    const dateMap = new Map<string, { sent: number; opened: number; clicked: number }>()

    for (let i = 29; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      dateMap.set(dateStr, { sent: 0, opened: 0, clicked: 0 })
    }

    events.forEach((event) => {
      const dateData = dateMap.get(event._id.date)
      if (dateData) {
        if (event._id.type === 'sent') dateData.sent = event.count
        else if (event._id.type === 'opened') dateData.opened = event.count
        else if (event._id.type === 'clicked') dateData.clicked = event.count
      }
    })

    const data = Array.from(dateMap.entries()).map(([date, stats]) => {
      const d = new Date(date)
      return {
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        ...stats,
      }
    })

    res.json({ data })
  } catch (error) {
    logger.error('Get chart data error:', error)
    res.status(500).json({ error: 'Failed to fetch chart data' })
  }
}

export const getCampaignAnalytics = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const { id } = req.params
    const campaign = await Campaign.findOne({
      _id: id,
      tenantId: req.user.tenantId,
    })

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }

    const events = await EmailEvent.aggregate([
      { $match: { campaignId: campaign._id } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ])

    const eventCounts = events.reduce(
      (acc, event) => {
        acc[event._id] = event.count
        return acc
      },
      {} as Record<string, number>
    )

    res.json({
      campaign: {
        id: campaign._id,
        name: campaign.name,
        status: campaign.status,
        sentAt: campaign.sentAt,
      },
      stats: campaign.stats,
      events: eventCounts,
    })
  } catch (error) {
    logger.error('Get campaign analytics error:', error)
    res.status(500).json({ error: 'Failed to fetch campaign analytics' })
  }
}
