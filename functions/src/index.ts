import * as admin from "firebase-admin";

admin.initializeApp();

export { createCheckoutSession } from "./stripe/createCheckoutSession";
export { stripeWebhook } from "./stripe/webhook";
export { verifySession } from "./stripe/verifySession";

export { createKycSession, refreshKycStatus, stripeIdentityWebhook } from "./kyc";

export { sendLoginAlert } from "./security";

export { generateCertificatesOnChallengeWrite, generateCertificatesOnAccountWrite, generateCertificatesOnPayoutWrite, adminRegenerateCertificate } from "./certificates";

export { adminChallengeProgression, evaluateAutomaticProgressionOnTrade } from "./challengeProgression";

export { sendProgressionOutcomeEmail } from "./progressionNotifications";

export { sendBrokerCredentialsEmail } from "./credentialDelivery";

export { submitLearningQuiz } from "./learningCertificates";

export { fundedMfa } from "./fundedMfa";
export { fundedCustomerAction } from "./nativeCustomer";
export { fundedMobileCheckout } from "./nativeCheckout";
export { fundedMobileIdentity } from "./kyc";
export { fundedWorkspace } from "./fundedWorkspace";
export { refreshFundedLeaderboard } from "./fundedLeaderboard";
export { fundedPrivacy } from "./fundedPrivacy";
