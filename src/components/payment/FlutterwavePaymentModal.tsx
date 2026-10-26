import React from 'react';
import { RelworxPaymentModal } from './RelworxPaymentModal';

/**
 * Backwards compatibility wrapper for RelworxPaymentModal
 */
export const FlutterwavePaymentModal: React.FC<any> = (props) => {
  return <RelworxPaymentModal {...props} />;
};

export { RelworxPaymentModal };
