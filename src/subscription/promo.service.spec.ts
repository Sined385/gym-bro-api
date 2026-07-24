import { PromoService } from './promo.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('PromoService.redeem', () => {
  const NOW = Date.now();

  const promo = (over: Record<string, any> = {}) => ({
    id: 'promo-1',
    code: 'LAUNCH2026',
    duration_days: 30,
    expires_at: new Date(NOW + 7 * DAY_MS),
    is_active: true,
    created_at: new Date(NOW - DAY_MS),
    ...over,
  });

  const freeUser = {
    is_premium: false,
    premium_source: null,
    premium_expires_at: null,
  };

  const makeService = (opts: {
    promo?: any;
    user?: any;
    createThrows?: any;
  }) => {
    const prisma = {
      promoCode: {
        findUnique: jest.fn().mockResolvedValue(opts.promo ?? null),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(opts.user ?? freeUser),
        update: jest.fn().mockResolvedValue({}),
      },
      promoRedemption: {
        create: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (ops: any[]) => {
        if (opts.createThrows) throw opts.createThrows;
        return Promise.all(ops);
      }),
    };
    const analytics = { track: jest.fn() };
    const service = new PromoService(prisma as any, analytics as any);
    return { service, prisma, analytics };
  };

  it('rejects an unknown code', async () => {
    const { service } = makeService({ promo: null });
    const result = await service.redeem('user-1', 'nope');
    expect(result).toMatchObject({ success: false, error_code: 'not_found' });
  });

  it('normalizes the code (trim + uppercase) before lookup', async () => {
    const { service, prisma } = makeService({ promo: promo() });
    await service.redeem('user-1', '  launch2026 ');
    expect(prisma.promoCode.findUnique).toHaveBeenCalledWith({
      where: { code: 'LAUNCH2026' },
    });
  });

  it('rejects a deactivated code', async () => {
    const { service } = makeService({ promo: promo({ is_active: false }) });
    const result = await service.redeem('user-1', 'LAUNCH2026');
    expect(result).toMatchObject({
      success: false,
      error_code: 'deactivated',
    });
  });

  it('rejects a code past its expiry', async () => {
    const { service } = makeService({
      promo: promo({ expires_at: new Date(NOW - DAY_MS) }),
    });
    const result = await service.redeem('user-1', 'LAUNCH2026');
    expect(result).toMatchObject({ success: false, error_code: 'expired' });
  });

  it('grants ~duration_days of premium to a free user', async () => {
    const { service, prisma } = makeService({ promo: promo() });
    const result = await service.redeem('user-1', 'LAUNCH2026');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.extended).toBe(false);
    const expiry = new Date(result.expires_at).getTime();
    expect(expiry).toBeGreaterThan(NOW + 29 * DAY_MS);
    expect(expiry).toBeLessThan(NOW + 31 * DAY_MS);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('extends active promo premium from its current expiry', async () => {
    const currentExpiry = new Date(NOW + 10 * DAY_MS);
    const { service } = makeService({
      promo: promo(),
      user: {
        is_premium: true,
        premium_source: 'promo',
        premium_expires_at: currentExpiry,
      },
    });
    const result = await service.redeem('user-1', 'LAUNCH2026');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.extended).toBe(true);
    expect(new Date(result.expires_at).getTime()).toBe(
      currentExpiry.getTime() + 30 * DAY_MS,
    );
  });

  it('treats EXPIRED promo premium as a fresh grant, not an extension', async () => {
    const { service } = makeService({
      promo: promo(),
      user: {
        is_premium: true,
        premium_source: 'promo',
        premium_expires_at: new Date(NOW - DAY_MS),
      },
    });
    const result = await service.redeem('user-1', 'LAUNCH2026');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.extended).toBe(false);
    expect(new Date(result.expires_at).getTime()).toBeLessThan(
      NOW + 31 * DAY_MS,
    );
  });

  it('blocks users with active StoreKit premium', async () => {
    const { service } = makeService({
      promo: promo(),
      user: {
        is_premium: true,
        premium_source: 'storekit',
        premium_expires_at: new Date(NOW + 20 * DAY_MS),
      },
    });
    const result = await service.redeem('user-1', 'LAUNCH2026');
    expect(result).toMatchObject({
      success: false,
      error_code: 'premium_conflict',
    });
  });

  it('blocks users with admin-granted premium (no expiry)', async () => {
    const { service } = makeService({
      promo: promo(),
      user: {
        is_premium: true,
        premium_source: 'admin',
        premium_expires_at: null,
      },
    });
    const result = await service.redeem('user-1', 'LAUNCH2026');
    expect(result).toMatchObject({
      success: false,
      error_code: 'premium_conflict',
    });
  });

  it('maps the unique-constraint violation to already_redeemed', async () => {
    const { service } = makeService({
      promo: promo(),
      createThrows: Object.assign(new Error('dup'), { code: 'P2002' }),
    });
    const result = await service.redeem('user-1', 'LAUNCH2026');
    expect(result).toMatchObject({
      success: false,
      error_code: 'already_redeemed',
    });
  });

  it('tracks redemption analytics on success', async () => {
    const { service, analytics } = makeService({ promo: promo() });
    await service.redeem('user-1', 'LAUNCH2026');
    expect(analytics.track).toHaveBeenCalledWith(
      'user-1',
      'promo_redeemed',
      expect.objectContaining({ code: 'LAUNCH2026', duration_days: 30 }),
    );
    expect(analytics.track).toHaveBeenCalledWith(
      'user-1',
      'premium_activated',
      expect.objectContaining({ source: 'promo' }),
    );
  });
});
