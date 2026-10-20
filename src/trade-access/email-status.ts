export function accountEmailStatus(status?: string): string {
  switch (status) {
    case 'pending': case 'sending': return 'Your account email is queued for sending.';
    case 'provider_accepted': return 'The email provider accepted your account email. Delivery is not yet confirmed.';
    case 'delivered': return 'Your email server accepted the account email. Check your inbox or spam folder.';
    case 'delayed': return 'Your email is delayed. The email provider is retrying delivery.';
    case 'bounced': return 'Your email could not be delivered. Contact support to check your email address.';
    case 'complained': case 'blocked': return 'Account email delivery needs support review.';
    case 'delivery_unknown': return 'Delivery confirmation is unavailable. Support can check before resending.';
    case 'failed': return 'The account email could not be sent. Contact support.';
    case 'cancelled': return 'This account email was cancelled after the account or payment status changed.';
    default: return 'Email delivery status is not available yet.';
  }
}
