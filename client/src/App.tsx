import { useEffect, useRef, useState } from "react";
import type { RoomSummary } from "@/bindings/RoomSummary";
import { useSession } from "@/hooks/useSession";
import { useRooms } from "@/hooks/useRooms";
import { useTimeline } from "@/hooks/useTimeline";
import { useSyncState } from "@/hooks/useSyncState";
import { usePanicGuard } from "@/hooks/usePanicGuard";
import { TitleBar } from "@/components/TitleBar";
import { SyncBanner } from "@/components/SyncBanner";
import { DegradedBanner } from "@/components/DegradedBanner";
import { Rail, type Surface } from "@/components/Rail";
import { ChatList } from "@/components/chats/ChatList";
import { ConversationPane } from "@/components/conversation/ConversationPane";
import { InfoDrawer } from "@/components/drawer/InfoDrawer";
import { SettingsView } from "@/components/settings/SettingsView";
import { CallsView } from "@/components/calls/CallsView";
import { NewChatModal } from "@/components/modals/NewChatModal";
import { Onboarding, OnboardingShell, RestoringSplash } from "@/components/onboarding/Onboarding";
import { LinkWhatsApp } from "@/components/onboarding/LinkWhatsApp";
import { TooltipProvider } from "@/components/ui/tooltip";

// Shell + state orchestration. All data flows through the hooks (which own the
// Tauri event subscriptions); this component only routes between surfaces:
// restoring → onboarding (sign-in, WhatsApp link) → chats | calls | settings.

// Below these window widths the layout collapses (Dispatch spec: drawer first,
// then list+pane become a single swappable pane).
const DRAWER_DOCK_MIN = 1180;
const TWO_PANE_MIN = 860;

export default function App() {
  const [surface, setSurface] = useState<Surface>("chats");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  // Onboarding step 2: shown after a FRESH login (not a restore) until the
  // user links WhatsApp or skips; reopenable from Settings → Add network.
  const [linking, setLinking] = useState(false);
  const [width, setWidth] = useState(() => window.innerWidth);

  // -- session / rooms / timeline wiring ------------------------------------
  // useSession resets dependent state on every auth transition. useTimeline and
  // useRooms reference each other (join → refresh; room-list → read receipt),
  // so the refresh side goes through a ref to avoid a circular hook order.
  const session = useSession((uid) => {
    if (!uid) {
      setSurface("chats");
      setDrawerOpen(false);
      setLinking(false);
    }
  });
  const syncState = useSyncState();
  const degraded = usePanicGuard();
  const refreshRoomsRef = useRef<() => void>(() => {});
  const tl = useTimeline(session.userId, () => refreshRoomsRef.current());
  const roomsState = useRooms(session.userId, tl.openRoom?.id ?? null);
  refreshRoomsRef.current = roomsState.refreshRooms;

  // Track window width for the collapse behavior.
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Esc closes the open conversation (back to the inbox).
  useEffect(() => {
    if (!tl.openRoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") tl.closeConversation();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tl.openRoom]);

  // Fresh-login → offer the WhatsApp link step when nothing is linked yet.
  async function handleLogin(hs: string, user: string, pass: string) {
    const ok = await session.login(hs, user, pass);
    if (ok) setLinking(true);
  }

  function openRoom(r: RoomSummary) {
    setSurface("chats");
    tl.openConversation(r);
  }

  // Keep the InfoDrawer's room in sync with the live list (mute/pin toggles
  // arrive via "room-list" refreshes).
  const liveOpenRoom = tl.openRoom
    ? roomsState.rooms.find((r) => r.id === tl.openRoom!.id) ?? tl.openRoom
    : null;

  const singlePane = width < TWO_PANE_MIN;
  const drawerOverlays = width < DRAWER_DOCK_MIN;

  // -- routing ---------------------------------------------------------------
  let body: React.ReactNode;
  if (session.restoring) {
    body = <RestoringSplash />;
  } else if (!session.userId) {
    body = (
      <Onboarding
        busy={session.busy}
        loginError={session.loginError}
        sessionExpired={session.sessionExpired}
        onLogin={handleLogin}
      />
    );
  } else if (linking) {
    body = (
      <OnboardingShell>
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="text-[22px] font-semibold tracking-[-0.01em]">Link WhatsApp</div>
          <div className="text-[13px] text-mut">Step 2 of 2 — scan once, chat everywhere.</div>
        </div>
        <LinkWhatsApp
          accountCount={roomsState.accounts.length}
          onDone={() => setLinking(false)}
        />
      </OnboardingShell>
    );
  } else {
    body = (
      <div className="flex min-h-0 flex-1">
        <Rail
          accounts={roomsState.accounts}
          accountFilter={roomsState.accountFilter}
          onAccountFilter={roomsState.setAccountFilter}
          unreadByAccount={roomsState.unreadByAccount}
          surface={surface}
          onSurface={(s) => setSurface(s)}
          userId={session.userId}
        />

        {surface === "settings" ? (
          <SettingsView
            accounts={roomsState.accounts}
            userId={session.userId}
            onAddNetwork={() => {
              tl.closeConversation();
              setSurface("chats");
              setLinking(true);
            }}
            onSignOut={() => session.logout()}
          />
        ) : surface === "calls" ? (
          <CallsView />
        ) : (
          <div className="relative flex min-w-0 flex-1">
            {(!singlePane || !tl.openRoom) && (
              <ChatList
                rooms={roomsState.rooms}
                visibleRooms={roomsState.visibleRooms}
                filter={roomsState.filter}
                onFilter={roomsState.setFilter}
                unreadTotal={roomsState.unreadTotal}
                archivedCount={roomsState.archivedCount}
                openRoomId={tl.openRoom?.id ?? null}
                onOpen={openRoom}
                onToggleFlag={roomsState.toggleRoomFlag}
                onCompose={() => setComposeOpen(true)}
                fullWidth={singlePane}
              />
            )}
            {(!singlePane || tl.openRoom) && (
              <ConversationPane
                room={liveOpenRoom}
                messages={tl.messages}
                userId={session.userId}
                loadingMsgs={tl.loadingMsgs}
                openError={tl.openError}
                actionError={tl.actionError}
                onDismissActionError={tl.clearActionError}
                onRetryOpen={tl.retryOpen}
                loadingOlder={tl.loadingOlder}
                reachedStart={tl.reachedStart}
                onLoadOlder={tl.loadOlder}
                draft={tl.draft}
                onDraft={tl.updateDraft}
                onSend={tl.send}
                replyTo={tl.replyTo}
                editing={tl.editing}
                onReply={(m) => {
                  tl.setReplyTo(m);
                  tl.setEditing(null);
                }}
                onEdit={(m) => {
                  tl.setEditing(m);
                  tl.setReplyTo(null);
                  tl.setDraft(m.body);
                }}
                onCancelContext={() => {
                  if (tl.editing) tl.setDraft("");
                  tl.setReplyTo(null);
                  tl.setEditing(null);
                }}
                onDelete={tl.removeMessage}
                onReact={tl.react}
                typingNames={tl.typingNames}
                uploading={tl.uploading}
                onAttach={tl.attachFile}
                onBack={tl.closeConversation}
                showBack={singlePane}
                onToggleDrawer={() => setDrawerOpen((v) => !v)}
                drawerOpen={drawerOpen}
              />
            )}
            {drawerOpen && liveOpenRoom && (
              <InfoDrawer
                room={liveOpenRoom}
                onClose={() => setDrawerOpen(false)}
                onToggleFlag={roomsState.toggleRoomFlag}
                overlay={drawerOverlays}
              />
            )}
            {/* Action errors normally render inside the conversation pane —
                but a failed OPEN (e.g. accepting an invite while offline)
                leaves no pane to render in, silently eating the error. Float
                it over the list instead. */}
            {tl.actionError && !tl.openRoom && (
              <div className="glass-float absolute bottom-4 left-1/2 z-20 flex max-w-[80%] -translate-x-1/2 items-center gap-2 rounded-full border border-danger/30 px-4 py-2 text-[13px] text-danger">
                <span className="min-w-0 truncate">{tl.actionError}</span>
                <button
                  type="button"
                  onClick={tl.clearActionError}
                  className="micro-sm flex-none hover:underline"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}

        <NewChatModal
          open={composeOpen}
          onOpenChange={setComposeOpen}
          rooms={roomsState.rooms}
          onOpenRoom={openRoom}
        />
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen flex-col overflow-hidden bg-ground text-ink">
        <TitleBar />
        <SyncBanner state={session.userId ? syncState : null} />
        {degraded && <DegradedBanner />}
        {body}
      </div>
    </TooltipProvider>
  );
}
