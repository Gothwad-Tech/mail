// =============================================================================
// The profile avatar in the header.
//
// Google's rule: the avatar is the entry point of the account sheet, and when
// more than one account is signed in it hints at that with a stacked "+n"
// bubble. The button hands its own element to the caller, because the shared
// widget positions its card directly under whichever avatar was tapped (mobile
// search-bar avatar vs desktop top-right avatar).
// =============================================================================

import React from 'react';
import { useMail } from '../context/MailContext';

export interface AccountAvatarButtonProps {
  variant: 'mobile' | 'desktop';
  onOpen: (anchor: HTMLElement) => void;
}

export const AccountAvatarButton: React.FC<AccountAvatarButtonProps> = ({ variant, onOpen }) => {
  const { currentUser, accounts, activeAccountId } = useMail();

  const others = accounts.filter((account) => account.id !== activeAccountId);
  const size = variant === 'mobile' ? 'h-8 w-8' : 'h-10 w-10';
  const bubbleSize = variant === 'mobile' ? 'h-8 w-8 text-[10px] -mr-2.5' : 'h-10 w-10 text-[11px] -mr-3';
  const label =
    accounts.length > 1 ? `Accounts (${accounts.length})` : variant === 'mobile' ? 'Account details' : 'User profile';

  return (
    <button
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
      className={`relative flex shrink-0 items-center rounded-full shadow-sm transition-opacity hover:opacity-90 ${
        variant === 'mobile' ? 'ml-1 h-8' : 'h-10'
      }`}
      aria-label={label}
      aria-haspopup="dialog"
      title={accounts.length > 1 ? 'Switch account (Shift+A)' : 'Account'}
    >
      {others.length > 0 && (
        <span
          className={`${bubbleSize} flex items-center justify-center rounded-full border-2 border-white bg-neutral-400 font-bold text-white dark:border-[#212121] dark:bg-neutral-600`}
        >
          +{accounts.length - 1}
        </span>
      )}
      <span className={`${size} flex items-center justify-center overflow-hidden rounded-full bg-[#0494f4] font-bold tracking-tight text-white`}>
        {currentUser.avatarUrl ? (
          <img
            src={currentUser.avatarUrl}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          currentUser.avatarText
        )}
      </span>
    </button>
  );
};
