import React, { ReactNode, useEffect, useRef } from 'react';
import { Animated, PanResponder, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';

/** Reserve only the screen edge, leaving chart and table gestures to their own views. */
export function EdgeBackGesture({ enabled, routeKey, onBack, children }: {
  enabled: boolean;
  routeKey: string;
  onBack: () => void;
  children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const offset = useRef(new Animated.Value(0)).current;
  const current = useRef({ enabled, onBack, width });
  current.current = { enabled, onBack, width };
  const busy = useRef(false);
  const horizontal = useRef(false);
  const reset = () => {
    Animated.spring(offset, { toValue: 0, useNativeDriver: true, overshootClamping: true }).start(() => { busy.current = false; });
  };
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => current.current.enabled && !busy.current,
    onMoveShouldSetPanResponder: () => current.current.enabled && !busy.current,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      offset.stopAnimation();
      horizontal.current = false;
    },
    onPanResponderMove: (_, g) => {
      if (!current.current.enabled || g.numberActiveTouches !== 1) return;
      if (g.dx > 10 && g.dx > Math.abs(g.dy) * 1.5) horizontal.current = true;
      if (horizontal.current) offset.setValue(Math.max(0, Math.min(current.current.width, g.dx)));
    },
    onPanResponderRelease: (_, g) => {
      busy.current = true;
      const goBack = current.current.enabled && horizontal.current && g.dx > Math.abs(g.dy)
        && (g.dx > Math.min(100, current.current.width * 0.28) || (g.dx > 35 && g.vx > 0.5));
      if (!goBack) { reset(); return; }
      Animated.timing(offset, { toValue: current.current.width, duration: 140, useNativeDriver: true }).start(({ finished }) => {
        if (finished && current.current.enabled) current.current.onBack();
        offset.setValue(0);
        busy.current = false;
      });
    },
    onPanResponderTerminate: reset,
  })).current;

  useEffect(() => {
    offset.stopAnimation();
    offset.setValue(0);
    busy.current = false;
    return () => { offset.stopAnimation(); };
  }, [offset, routeKey, enabled]);

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.root, { transform: [{ translateX: offset }] }]}>{children}</Animated.View>
      {enabled && Platform.OS === 'ios' ? <View accessible={false} style={styles.edge} {...responder.panHandlers} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  edge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 20 },
});
