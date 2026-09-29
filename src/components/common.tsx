import { App as AntApp, Button, Space, Tag, Timeline, Typography } from 'antd';
import { FilePdfOutlined, LockOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Data, FileRef, HistoryEntry } from '../types';
import { useData, useMe, useStore } from '../store';
import { canDownloadFile } from '../logic';
import { downloadBlob, getFile, makeDemoPdf } from '../files';

export const fmtDate = (s?: string | null) => (s ? dayjs(s).format('DD.MM.YYYY HH:mm') : '—');
export const fmtDay = (s?: string | null) => (s ? dayjs(s).format('DD.MM.YYYY') : '—');

export const userName = (d: Data, id: string) =>
  id === 'system' ? 'Система' : d.users.find((u) => u.id === id)?.name || '—';

/** Обёртка для действий: показывает ошибки бизнес-логики и сообщение об успехе. */
export function useAction() {
  const { message } = AntApp.useApp();
  const run = useStore((s) => s.run);
  return <T,>(fn: (d: Data, userId: string) => T, success?: string | ((r: T) => string | undefined)) => {
    try {
      const r = run(fn);
      const msg = typeof success === 'function' ? success(r) : success;
      if (msg) message.success(msg, 4);
      return r;
    } catch (e: any) {
      message.error(e?.message || String(e), 6);
      return undefined;
    }
  };
}

export async function downloadFileRef(f: FileRef) {
  const blob = (await getFile(f.id)) || makeDemoPdf(f.name);
  await downloadBlob(blob, f.name);
}

export function FileLink({ file, label }: { file?: FileRef | null; label?: string }) {
  const data = useData();
  const me = useMe();
  const { message } = AntApp.useApp();
  if (!file) return <Typography.Text type="secondary">{label ? `${label}: ` : ''}не загружен</Typography.Text>;
  const allowed = me && canDownloadFile(data, me, file.id);
  return (
    <Space size={4}>
      {label && <Typography.Text type="secondary">{label}:</Typography.Text>}
      <Button
        size="small"
        type="link"
        icon={allowed ? <FilePdfOutlined /> : <LockOutlined />}
        disabled={!allowed}
        onClick={async () => {
          // В проде: проверка прав на бэке → signed URL на 1 час
          if (!allowed) return message.error('Нет доступа к файлу');
          await downloadFileRef(file);
        }}
        style={{ padding: 0 }}
      >
        {file.name}
      </Button>
    </Space>
  );
}

/** Закрытие модального окна с подтверждением, если есть несохранённые данные (клик мимо окна, Esc, «Отмена»). */
export function useGuardedClose() {
  const { modal } = AntApp.useApp();
  return (dirty: boolean, close: () => void) => {
    if (!dirty) return close();
    modal.confirm({
      title: 'Закрыть без сохранения?',
      content: 'Введённые данные будут потеряны.',
      okText: 'Закрыть',
      okButtonProps: { danger: true },
      cancelText: 'Продолжить редактирование',
      onOk: close,
    });
  };
}

export function History({ items, maxHeight = 420 }: { items: (HistoryEntry & { source?: string })[]; maxHeight?: number }) {
  const data = useData();
  const me = useMe();
  if (!items.length) return <Typography.Text type="secondary">Событий пока нет</Typography.Text>;
  return (
    <div style={{ maxHeight, overflowY: 'auto', paddingTop: 8, paddingRight: 8 }}>
    <Timeline
      style={{ marginTop: 8, marginBottom: 0 }}
      items={[...items].reverse().map((h) => {
        const hideComment = me?.role === 'CLIENT' && h.hiddenFromClient;
        return {
          color: h.highlight ? 'magenta' : /отклон|возвращ|отозв/i.test(h.action) ? 'red' : /одобр|соглас/i.test(h.action) ? 'green' : 'blue',
          children: (
            <div style={h.highlight ? { background: '#fff0f6', border: '1px solid #ffadd2', borderRadius: 6, padding: '4px 8px' } : undefined}>
              <div>
                {h.source && <Tag style={{ fontSize: 11 }}>{h.source}</Tag>}
                <b>{h.action}</b>
              </div>
              {h.comment && !hideComment && <div style={{ background: '#fff7e6', padding: '4px 8px', borderRadius: 4, margin: '4px 0' }}>{h.comment}</div>}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {fmtDate(h.at)} · {userName(data, h.userId)}
              </Typography.Text>
            </div>
          ),
        };
      })}
    />
    </div>
  );
}

export const StatusTag = ({ s }: { s: { label: string; color: string } }) => <Tag color={s.color}>{s.label}</Tag>;
