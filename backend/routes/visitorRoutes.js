'use strict';

const { createVisitorAnalyticsSchema } = require('../services/visitorAnalyticsSchema');
const {
    VisitorAnalyticsInputError,
    createVisitorAnalyticsService,
} = require('../services/visitorAnalyticsService');
const {
    createMemberLoginActivityService,
} = require('../services/memberLoginActivityService');
const { createVisitSessionService } = require('../services/visitSessionService');

function isAuthenticatedAdmin(auth) {
    return Boolean(
        (auth?.valid || auth?.ok)
        && (auth?.isAdmin || auth?.isPrimaryAdmin || auth?.isOperator)
    );
}

function clientIdFromRequest(req) {
    const value = req?.headers?.['x-wgs-client-id'];
    return Array.isArray(value) ? value[0] : value;
}

function parseCookies(cookieHeader = '') {
    return String(cookieHeader || '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .reduce((cookies, part) => {
            const separator = part.indexOf('=');
            if (separator <= 0) return cookies;
            try {
                const name = decodeURIComponent(part.slice(0, separator).trim());
                const value = decodeURIComponent(part.slice(separator + 1).trim());
                cookies[name] = value;
            } catch (_) {
                // Ignore one malformed cookie without blocking public visit tracking.
            }
            return cookies;
        }, {});
}

function appendSetCookie(res, cookie) {
    if (typeof res.append === 'function') {
        res.append('Set-Cookie', cookie);
        return;
    }
    const current = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : undefined;
    const values = current === undefined
        ? cookie
        : [...(Array.isArray(current) ? current : [current]), cookie];
    res.setHeader('Set-Cookie', values);
}

function setNoStore(res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
}

function errorStatus(error) {
    if (error instanceof VisitorAnalyticsInputError) return 400;
    const status = Number(error?.statusCode);
    return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function registerVisitorRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const validateAdminSession = options.validateAdminSession;
    const visitorService = options.visitorService
        || createVisitorAnalyticsService({
            pool,
            env: options.env,
            clock: options.clock,
            crypto: options.crypto,
        });
    const schema = options.visitorSchema
        || (pool ? createVisitorAnalyticsSchema({ pool }) : null);
    const memberLoginActivityService = options.memberLoginActivityService
        || (pool ? createMemberLoginActivityService({
            pool,
            clock: options.clock,
        }) : null);
    const ensureSchema = options.ensureVisitorAnalyticsSchema
        || schema?.ensureVisitorAnalyticsSchema
        || (async () => {});
    const visitSessionService = options.visitSessionService
        || (pool ? createVisitSessionService({
            pool,
            env: options.env,
            clock: options.clock,
            crypto: options.crypto,
            schema,
            ensureSchema,
        }) : visitorService);

    if (!app || typeof app.post !== 'function' || typeof app.get !== 'function') {
        throw new Error('registerVisitorRoutes requires an Express app.');
    }
    if (typeof validateAdminSession !== 'function') {
        throw new Error('registerVisitorRoutes requires validateAdminSession.');
    }
    if (!visitorService || typeof visitorService.recordVisit !== 'function'
        || typeof visitorService.getPublicSummary !== 'function'
        || typeof visitorService.getAdminStats !== 'function'
        || typeof visitorService.verifyAdminExclusionToken !== 'function'
        || typeof visitorService.createAdminExclusionCookie !== 'function'
        || !visitorService.adminExclusionCookieName) {
        throw new Error('registerVisitorRoutes requires a visitor analytics service.');
    }
    if (!visitSessionService
        || typeof visitSessionService.recordVisit !== 'function'
        || typeof visitSessionService.getPublicSummary !== 'function'
        || typeof visitSessionService.getAdminStats !== 'function') {
        throw new Error('registerVisitorRoutes requires a visit session service.');
    }

    app.post('/api/visitors/visit', async (req, res) => {
        try {
            await ensureSchema();
            const cookies = parseCookies(req?.headers?.cookie);
            const exclusionToken = cookies[visitorService.adminExclusionCookieName];
            if (visitorService.verifyAdminExclusionToken(exclusionToken)) {
                const summary = await visitSessionService.getPublicSummary();
                return res.json({
                    success: true,
                    counted: false,
                    ignored: true,
                    reason: 'admin_excluded',
                    ...summary,
                });
            }

            const result = await visitSessionService.recordVisit({
                clientId: clientIdFromRequest(req),
                request: req,
            });
            return res.json({ success: true, ...result });
        } catch (error) {
            const status = errorStatus(error);
            if (status >= 500) console.error('[visitor analytics] public visit failed:', error.message);
            return res.status(status).json({
                success: false,
                reason: error?.code || 'visitor_analytics_error',
                message: status === 400
                    ? error.message
                    : 'Unable to record the visit right now.',
            });
        }
    });

    app.get('/api/admin/visitors/stats', async (req, res) => {
        setNoStore(res);
        try {
            const adminAuth = await validateAdminSession(req);
            if (!isAuthenticatedAdmin(adminAuth)) {
                const statusCode = adminAuth?.reason === 'not_admin'
                    ? 403
                    : (Number(adminAuth?.statusCode) >= 400 ? Number(adminAuth.statusCode) : 401);
                return res.status(statusCode).json({
                    success: false,
                    reason: adminAuth?.reason || 'invalid_admin_session',
                    message: adminAuth?.message || 'Administrator authentication is required.',
                });
            }

            await ensureSchema();
            const result = await visitSessionService.getAdminStats({
                period: req?.query?.period,
                anchor: req?.query?.anchor,
                types: req?.query?.types,
                memberIds: req?.query?.memberIds,
                status: req?.query?.status,
            });
            appendSetCookie(res, visitorService.createAdminExclusionCookie());
            return res.json({ success: true, ...result });
        } catch (error) {
            const status = errorStatus(error);
            if (status >= 500) console.error('[visitor analytics] admin stats failed:', error.message);
            return res.status(status).json({
                success: false,
                reason: error?.code || 'visitor_analytics_error',
                message: status === 400
                    ? error.message
                    : 'Unable to load visitor statistics right now.',
            });
        }
    });

    app.get('/api/admin/visitors/sessions', async (req, res) => {
        setNoStore(res);
        try {
            const adminAuth = await validateAdminSession(req);
            if (!isAuthenticatedAdmin(adminAuth)) {
                const statusCode = adminAuth?.reason === 'not_admin'
                    ? 403
                    : (Number(adminAuth?.statusCode) >= 400 ? Number(adminAuth.statusCode) : 401);
                return res.status(statusCode).json({
                    success: false,
                    reason: adminAuth?.reason || 'invalid_admin_session',
                    message: adminAuth?.message || 'Administrator authentication is required.',
                });
            }
            if (typeof visitSessionService.getAdminSessions !== 'function') {
                throw new Error('Visit session list service is unavailable.');
            }
            await ensureSchema();
            const result = await visitSessionService.getAdminSessions({
                period: req?.query?.period,
                anchor: req?.query?.anchor,
                types: req?.query?.types,
                memberIds: req?.query?.memberIds,
                status: req?.query?.status,
                page: req?.query?.page,
                pageSize: req?.query?.pageSize,
            });
            appendSetCookie(res, visitorService.createAdminExclusionCookie());
            return res.json({ success: true, ...result });
        } catch (error) {
            const status = errorStatus(error);
            if (status >= 500) console.error('[visit sessions] admin list failed:', error.message);
            return res.status(status).json({
                success: false,
                reason: error?.code || 'visit_session_error',
                message: status === 400
                    ? error.message
                    : 'Unable to load visit sessions right now.',
            });
        }
    });

    app.get('/api/admin/visitors/members', async (req, res) => {
        setNoStore(res);
        try {
            const adminAuth = await validateAdminSession(req);
            if (!isAuthenticatedAdmin(adminAuth)) {
                const statusCode = adminAuth?.reason === 'not_admin'
                    ? 403
                    : (Number(adminAuth?.statusCode) >= 400 ? Number(adminAuth.statusCode) : 401);
                return res.status(statusCode).json({
                    success: false,
                    reason: adminAuth?.reason || 'invalid_admin_session',
                    message: adminAuth?.message || 'Administrator authentication is required.',
                });
            }
            if (typeof visitSessionService.getAdminMembers !== 'function') {
                throw new Error('Visit session member filter service is unavailable.');
            }
            await ensureSchema();
            const result = await visitSessionService.getAdminMembers({
                query: req?.query?.query,
                limit: req?.query?.limit,
            });
            appendSetCookie(res, visitorService.createAdminExclusionCookie());
            return res.json({ success: true, ...result });
        } catch (error) {
            const status = errorStatus(error);
            if (status >= 500) console.error('[visit sessions] member filter failed:', error.message);
            return res.status(status).json({
                success: false,
                reason: error?.code || 'visit_session_error',
                message: status === 400
                    ? error.message
                    : 'Unable to load visitor members right now.',
            });
        }
    });

    app.get('/api/admin/member-login-activity/stats', async (req, res) => {
        setNoStore(res);
        try {
            const adminAuth = await validateAdminSession(req);
            if (!isAuthenticatedAdmin(adminAuth)) {
                const statusCode = adminAuth?.reason === 'not_admin'
                    ? 403
                    : (Number(adminAuth?.statusCode) >= 400 ? Number(adminAuth.statusCode) : 401);
                return res.status(statusCode).json({
                    success: false,
                    reason: adminAuth?.reason || 'invalid_admin_session',
                    message: adminAuth?.message || 'Administrator authentication is required.',
                });
            }

            if (!memberLoginActivityService || typeof memberLoginActivityService.getStats !== 'function') {
                throw new Error('Member login activity service is unavailable.');
            }
            const result = await memberLoginActivityService.getStats({
                period: req?.query?.period,
                anchor: req?.query?.anchor,
            });
            return res.json({ success: true, ...result });
        } catch (error) {
            const status = errorStatus(error);
            if (status >= 500) console.error('[member login activity] admin stats failed:', error.message);
            return res.status(status).json({
                success: false,
                reason: error?.code || 'member_login_activity_error',
                message: status === 400
                    ? error.message
                    : 'Unable to load member login activity right now.',
            });
        }
    });

    return {
        visitorService,
        visitSessionService,
        memberLoginActivityService,
        ensureVisitorAnalyticsSchema: ensureSchema,
    };
}

module.exports = registerVisitorRoutes;
module.exports.registerVisitorRoutes = registerVisitorRoutes;
module.exports.isAuthenticatedAdmin = isAuthenticatedAdmin;
module.exports.parseCookies = parseCookies;
