import * as ImagePicker from 'expo-image-picker';
import { Stack as RouterStack } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, Pressable, View } from 'react-native';

import {
  Button,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  Notice,
  Row,
  Screen,
  Section,
  Segmented,
  StatusPill,
  Text,
} from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { getActiveCampaign } from '@/data/local/repositories/campaign';
import {
  addPhoto,
  deletePhotoRecord,
  listPhotos,
  setLocalUri,
  type PhotoCategory,
  type ProgressPhoto,
} from '@/data/local/repositories/photos';
import { getPreferences } from '@/data/local/repositories/settings';
import { getSupabase } from '@/data/remote/supabaseClient';
import { signedPhotoUrl } from '@/data/remote/sync/supabaseTransport';
import {
  deletePhotoFile,
  downloadPhoto,
  importPhoto,
  photoExists,
} from '@/features/photos/photoFiles';
import { colors, radius, spacing, type StatusTone } from '@/theme/tokens';

const COLUMNS = 3;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const CATEGORIES: { value: PhotoCategory; label: string }[] = [
  { value: 'front', label: 'Front' },
  { value: 'side', label: 'Side' },
  { value: 'back', label: 'Back' },
  { value: 'other', label: 'Other' },
];

const uploadPill: Record<string, { label: string; tone: StatusTone }> = {
  local_only: { label: 'On device only', tone: 'neutral' },
  pending: { label: 'Backup pending', tone: 'warning' },
  uploading: { label: 'Uploading', tone: 'info' },
  uploaded: { label: 'Backed up (private)', tone: 'success' },
  failed: { label: 'Backup failed', tone: 'danger' },
};

export default function PhotosScreen() {
  const [category, setCategory] = useState<PhotoCategory>('front');
  const [compare, setCompare] = useState(false);
  const q = useQuery(async (db) => ({
    photos: await listPhotos(db),
    prefs: await getPreferences(db),
    campaign: await getActiveCampaign(db),
  }));
  const add = useMutation((db, uri: string) =>
    addPhoto(db, {
      localUri: uri,
      category,
      campaignId: q.data?.campaign?.id ?? null,
      notes: null,
      cloudBackup: !!q.data?.prefs.cloudSync,
    }),
  );
  const restore = useMutation(async (db, p: ProgressPhoto) => {
    const sb = getSupabase();
    if (!sb || !p.remote_path) throw new Error('Sign in to cloud backup to load this photo.');
    const url = await signedPhotoUrl(sb, p.remote_path, 60);
    if (!url) throw new Error('Could not access the private backup.');
    await setLocalUri(db, p.id, await downloadPhoto(url));
  });
  const remove = useMutation(async (db, p: ProgressPhoto) => {
    const deleted = await deletePhotoRecord(db, p.id);
    deletePhotoFile(deleted?.local_uri ?? null); // after the DB commit
  });

  if (q.error) return <ErrorState message={q.error} />;
  if (!q.data) return <LoadingState />;
  const { photos, prefs } = q.data;
  const inCategory = photos.filter((p) => p.category === category);

  const pick = async (source: 'camera' | 'library') => {
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permission needed',
        `GymOS needs ${source === 'camera' ? 'camera' : 'photo library'} access to add a progress photo. You can enable it in system settings.`,
      );
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: false,
      exif: false,
    };
    const res =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets[0]) return;
    try {
      const uri = importPhoto(res.assets[0].uri);
      await add.run(uri);
    } catch (e) {
      Alert.alert(
        'Photo not saved',
        e instanceof Error ? e.message : 'Check available storage and try again.',
      );
    }
  };

  const onDelete = (p: ProgressPhoto) =>
    Alert.alert(
      'Delete photo?',
      p.remote_path
        ? 'Removes it from this device and queues deletion of the private cloud copy.'
        : 'Removes it from this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => remove.run(p) },
      ],
    );

  const first = inCategory[inCategory.length - 1];
  const latest = inCategory[0];

  return (
    <Screen edges={['bottom']}>
      <RouterStack.Screen options={{ title: '' }} />
      <Header
        eyebrow={prefs.cloudSync ? 'Private · backed up' : 'Private · on this device'}
        title="Photos"
        subtitle="Never shared, never analysed, never sent to the AI coach."
      />
      <Notice
        tone="neutral"
        title="For comparable photos"
        message="Same spot, lighting, distance and time of day. Relaxed posture, camera at chest height."
      />
      <Segmented options={CATEGORIES} value={category} onChange={setCategory} />
      <Row>
        <Button label="Camera" onPress={() => pick('camera')} grow loading={add.pending} />
        <Button label="Library" variant="secondary" onPress={() => pick('library')} grow />
      </Row>

      {inCategory.length >= 2 ? (
        <Button
          label={compare ? 'Show timeline' : 'Compare first vs latest'}
          variant="ghost"
          onPress={() => setCompare((c) => !c)}
        />
      ) : null}

      {compare && first && latest ? (
        <Row style={{ alignItems: 'flex-start' }}>
          {[first, latest].map((p) => (
            <View key={p.id} style={{ flex: 1, gap: 4 }}>
              <Thumb photo={p} size="large" />
              <Text variant="caption" muted center>
                {new Date(p.captured_at).toLocaleDateString()}
              </Text>
            </View>
          ))}
        </Row>
      ) : (
        <Section title={`${CATEGORIES.find((c) => c.value === category)!.label} timeline`}>
          {inCategory.length === 0 ? (
            <EmptyState
              title="No photos yet"
              message="Add your first photo to start a private timeline."
            />
          ) : null}
          {chunk(inCategory, COLUMNS).map((rowPhotos, ri) => (
            <View key={ri} style={{ flexDirection: 'row', gap: spacing.sm }}>
              {rowPhotos.map((p) => (
                <Pressable
                  key={p.id}
                  onLongPress={() => onDelete(p)}
                  onPress={() =>
                    !photoExists(p.local_uri) && p.remote_path
                      ? restore.run(p).catch((e: Error) => Alert.alert('Not loaded', e.message))
                      : undefined
                  }
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`${p.category} photo from ${new Date(p.captured_at).toLocaleDateString()}. Long press to delete.`}
                  style={{ flex: 1, gap: spacing.xs }}
                >
                  <Thumb photo={p} size="small" />
                  <Text variant="caption" muted numberOfLines={1}>
                    {new Date(p.captured_at).toLocaleDateString()}
                  </Text>
                  {uploadPill[p.upload_status] ? (
                    <StatusPill
                      label={uploadPill[p.upload_status]!.label}
                      tone={uploadPill[p.upload_status]!.tone}
                    />
                  ) : null}
                </Pressable>
              ))}
              {Array.from({ length: COLUMNS - rowPhotos.length }, (_, i) => (
                <View key={`pad${i}`} style={{ flex: 1 }} />
              ))}
            </View>
          ))}
          {inCategory.length > 0 ? (
            <Text variant="caption" faint>
              Long-press a photo to delete it.
            </Text>
          ) : null}
        </Section>
      )}
      <Text variant="caption" faint>
        GymOS does not estimate body fat or muscle from photos. Free cloud storage is limited (1 GB
        on Supabase Free) — export anything important.
      </Text>
    </Screen>
  );
}

function Thumb({ photo, size }: { photo: ProgressPhoto; size: 'small' | 'large' }) {
  const ok = photoExists(photo.local_uri);
  const style = {
    width: '100%' as const,
    aspectRatio: 3 / 4,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  };
  if (!ok) {
    return (
      <View style={[style, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text variant="caption" faint center>
          {photo.remote_path ? 'In private backup — tap to load' : 'File missing'}
        </Text>
      </View>
    );
  }
  // resizeMethod="resize" keeps memory low: thumbnails are decoded at view size, not full resolution.
  return (
    <Image
      source={{ uri: photo.local_uri! }}
      style={style}
      resizeMode="cover"
      resizeMethod={size === 'small' ? 'resize' : 'auto'}
      accessibilityIgnoresInvertColors
    />
  );
}
