import React, { useEffect, useState } from 'react';
import * as RN from 'react-native';
import { Image, LogBox, Platform, Pressable, View } from 'react-native';
import { BrokerAccount, Brokers, MergedHolding } from './src/domain/models';
import { Native } from './src/platform/native';
import { store, useStoreData } from './src/store/store';
import { EdgeBackGesture } from './src/ui/EdgeBackGesture';
import { AssetDetailScreen } from './src/screens/asset/AssetDetailScreen';
import { AccountEditor } from './src/screens/accounts/AccountEditor';
import { AssetHome } from './src/screens/AssetHome';
import { ChatScreen } from './src/screens/ChatScreen';
import { GoalsScreen, goalsTitle } from './src/screens/GoalsScreen';
import { PortfolioScreen } from './src/screens/PortfolioScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TradesScreen } from './src/screens/TradesScreen';
import { USScreen } from './src/screens/us/USScreen';
import { Home } from './src/navigation/Home';
import { Page, titles } from './src/navigation/pages';
import { SyncFooter } from './src/navigation/SyncFooter';
import { C, Card, Confirm, FS, Skeleton, SkeletonRows, T, useCompact } from './src/ui';

// iOS needs the notch/home-indicator insets; core SafeAreaView still works in RN 0.81 but warns on access.
LogBox.ignoreLogs(['SafeAreaView has been deprecated']);
const Root: React.ComponentType<RN.ViewProps> = Platform.OS === 'ios' ? RN.SafeAreaView : View;

export default function App() {
  const s = useStoreData();
  const compact = useCompact();
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashReady, setSplashReady] = useState(false);
  const [page, setPageState] = useState<Page>('portfolio');
  // Home is the menu; each page opens on top of it.
  const [menu, setMenu] = useState(true);
  const [asset, setAsset] = useState<MergedHolding | null>(null);
  // An account opens on its summary; this is the account whose holdings list is showing instead.
  const [holdingsOf, setHoldingsOf] = useState<string | null>(null);
  const setPage = (p: Page) => { setAsset(null); setHoldingsOf(null); setPageState(p); setMenu(false); };
  const [editor, setEditor] = useState<{ account?: BrokerAccount; exchange: boolean } | null>(null);
  const [deleting, setDeleting] = useState<BrokerAccount | null>(null);

  useEffect(() => {
    store.load().then(() => {
      Native.setAppearance(store.data.settings.appearance);
      store.start();
    });
  }, []);

  // Keep startup work running while the bundled logo is visible; resuming does not replay it.
  useEffect(() => {
    if (!splashReady) return;
    const timer = setTimeout(() => setSplashVisible(false), 2000);
    return () => clearTimeout(timer);
  }, [splashReady]);

  if (splashVisible) {
    return (
      <View style={{ flex: 1, backgroundColor: '#D7FBDF', alignItems: 'center', justifyContent: 'center' }}>
        <Image source={require('./assets/logo.png')} accessibilityLabel="MyFolio 로고" resizeMode="contain"
          style={{ width: 180, height: 180, maxWidth: '80%', maxHeight: '80%' }} onLoadEnd={() => setSplashReady(true)} />
      </View>
    );
  }

  // Reading the data file: show the home layout as placeholders instead of a blank window.
  if (!s.loaded) {
    return (
      <Root style={{ flex: 1, backgroundColor: C.window }}>
        <View style={{ flex: 1, padding: 16, gap: 12, maxWidth: compact ? undefined : 760 }}>
          <Skeleton width={110} height={26} />
          <Card style={{ gap: 10 }}>
            <Skeleton width={60} height={16} />
            <Skeleton width={210} height={34} />
            <Skeleton width={150} height={16} />
          </Card>
          <Card style={{ paddingVertical: 8 }}><SkeletonRows rows={4} avatar /></Card>
        </View>
      </Root>
    );
  }

  const account = page.startsWith('account:') ? s.account(page.slice(8)) : undefined;
  const edit = (a: BrokerAccount) => setEditor({ account: a, exchange: Brokers[a.broker].exchange });

  const showHoldings = account && holdingsOf === account.id;
  const goalsPage = !menu && page === 'goals' && !asset;
  const goBack = () => asset ? setAsset(null) : showHoldings ? setHoldingsOf(null) : setMenu(true);
  const detail = (
    <EdgeBackGesture enabled={Platform.OS === 'ios' && compact && !menu && !editor && !deleting}
      routeKey={`${page}:${asset?.identityKey ?? ''}`} onBack={goBack}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 10 }}>
          <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel={asset ? '종목 목록으로 돌아가기' : '메뉴로 돌아가기'} hitSlop={12} style={{ paddingHorizontal: 6 }}>
            <T style={[{ fontSize: 30, lineHeight: 32, fontWeight: '300' }, goalsPage && { color: C.goalInk }]}>‹</T>
          </Pressable>
          <T style={[{ flex: 1, fontWeight: '700', fontSize: FS + 2 }, goalsPage && goalsTitle]} numberOfLines={1}>{goalsPage ? '내 투자 여정' : asset ? asset.name : account?.name ?? titles[page]}</T>
        </View>
      <View style={{ flex: 1, display: asset ? 'none' : 'flex' }}>
      {page === 'trades' ? <TradesScreen />
        : page === 'goals' ? <GoalsScreen />
        : page === 'us' ? <USScreen />
        : page === 'chat' ? <ChatScreen openSettings={() => setPage('settings')} />
        : page === 'settings' ? <SettingsScreen />
        : showHoldings ? <PortfolioScreen key={account.id} startWith="list" onSelectAsset={setAsset} account={account} onEdit={() => edit(account)} />
        : account ? <AssetHome key={account.id} account={account} onHoldings={() => setHoldingsOf(account.id)} onAsset={setAsset} onEdit={() => edit(account)} />
        : <PortfolioScreen onSelectAsset={setAsset} onAdd={exchange => setEditor({ exchange })} />}
      </View>
      {asset ? <AssetDetailScreen key={`${account?.id ?? 'all'}:${asset.identityKey}`} holding={asset} accountId={account?.id} onBack={() => setAsset(null)} /> : null}
    </EdgeBackGesture>
  );

  return (
    <Root style={{ flex: 1, backgroundColor: C.window }}>
      {menu ? <Home onPage={setPage} onAsset={m => { setPageState('portfolio'); setMenu(false); setAsset(m); }} onAdd={exchange => setEditor({ exchange })} footer={<SyncFooter />} /> : detail}

      {editor ? (
        <AccountEditor account={editor.account} exchange={editor.exchange} onClose={() => setEditor(null)}
          onDelete={editor.account ? () => setDeleting(editor.account!) : undefined}
          onFull={editor.account && editor.account.broker !== 'manual' ? () => s.sync.fullHistory(editor.account!) : undefined} />
      ) : null}
      {deleting ? (
        <Confirm message={`'${deleting.name}' 계좌와 관련 보유 데이터를 모두 삭제할까요?`} action="삭제"
          onConfirm={() => { if (page === `account:${deleting.id}`) { setAsset(null); setPageState('portfolio'); setMenu(true); } setEditor(null); s.accounts.remove(deleting); }}
          onClose={() => setDeleting(null)} />
      ) : null}
    </Root>
  );
}
