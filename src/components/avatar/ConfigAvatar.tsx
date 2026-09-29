import { Avatar, type AvatarProps } from "@/components/ui/Avatar";
import type { AvatarConfig } from "@/lib/avatar/key";
import { avatarDataUri } from "@/lib/avatar/render";

/**
 * <Avatar> drawn locally from a DiceBear config (memoized data URI). Imports
 * the DiceBear styles, so use it where they're needed anyway: the customizer,
 * live previews, and server components (zero client JS there). For other
 * users' avatars in lists, plain <Avatar user={…}> is lighter.
 */
export function ConfigAvatar({ config, ...rest }: Omit<AvatarProps, "src"> & { config: AvatarConfig }) {
  return <Avatar {...rest} src={avatarDataUri(config)} />;
}
