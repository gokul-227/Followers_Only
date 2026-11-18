ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_price_nonnegative" CHECK ("monthlyPriceCents" >= 0 AND "monthlyPriceCents" <= 100000);
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_price_nonnegative" CHECK ("priceCents" >= 0);
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_no_self" CHECK ("subscriberId" <> "creatorId");
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_amount_nonnegative" CHECK ("amountCents" >= 0);
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "Media" ADD CONSTRAINT "Media_size_positive" CHECK ("size" > 0);
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_no_self" CHECK ("followerId" <> "followedId");
ALTER TABLE "PostMedia" ADD CONSTRAINT "PostMedia_position_nonnegative" CHECK ("position" >= 0);
