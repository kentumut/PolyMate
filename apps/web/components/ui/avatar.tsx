'use client';

import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '@/lib/utils';

function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return <AvatarPrimitive.Root className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)} {...props} />;
}

function AvatarFallback({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return <AvatarPrimitive.Fallback className={cn('flex size-full items-center justify-center rounded-full bg-muted text-xs font-medium', className)} {...props} />;
}

export { Avatar, AvatarFallback };
