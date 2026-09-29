import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge, Button, Card, Collapse, Empty, Input, Pagination, Segmented, Select, Space, Switch, Tag, Typography,
} from 'antd';
import { CheckOutlined, SearchOutlined, SendOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useData, useMe } from '../store';
import { NOTIFICATION_KIND, type Notification, type NotificationKind } from '../types';
import { nowMs } from '../engine';
import { fmtDate, useAction } from '../components/common';

type GroupBy = 'object' | 'day' | 'kind';
const PAGE = 15;
const IN_GROUP = 8;

interface Group {
  key: string;
  title: string;
  subtitle?: string;
  items: Notification[];
  unread: number;
  last: Notification;
}

export default function Notifications() {
  const data = useData();
  const me = useMe()!;
  const nav = useNavigate();
  const act = useAction();
  const mine = useMemo(() => data.notifications.filter((n) => n.userId === me.id), [data.notifications, me.id]);
  const [kind, setKind] = useState<NotificationKind | 'all'>('all');
  const [unreadOnly, setUnreadOnly] = useState(mine.some((n) => !n.read));
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<number>(0);
  const [groupBy, setGroupBy] = useState<GroupBy>('object');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Record<string, number>>({});

  const now = nowMs(data);
  const objName = (id?: string | null) => {
    const o = data.objects.find((x) => x.id === id);
    return o ? `№ ${o.excelRowNumber}. ${o.name}` : null;
  };
  const exName = (id?: string | null) => data.executions.find((e) => e.id === id)?.name;

  const filtered = mine.filter((n) => {
    if (kind !== 'all' && n.kind !== kind) return false;
    if (unreadOnly && n.read) return false;
    if (period && now - new Date(n.at).getTime() > period * 86400000) return false;
    if (q) {
      const hay = `${n.text} ${objName(n.objectId) || ''}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const countBy = (k: NotificationKind | 'all') =>
    mine.filter((n) => !n.read && (k === 'all' || n.kind === k)).length;

  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Notification[]>();
    filtered.forEach((n) => {
      const key = groupBy === 'object' ? n.objectId || '_system'
        : groupBy === 'day' ? dayjs(n.at).format('YYYY-MM-DD') : n.kind;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    });
    const out: Group[] = [...map.entries()].map(([key, items]) => {
      items.sort((a, b) => b.at.localeCompare(a.at));
      let title = key;
      let subtitle: string | undefined;
      if (groupBy === 'object') {
        title = key === '_system' ? 'Сводки и системные' : objName(key) || 'Удалённый объект';
        const o = data.objects.find((x) => x.id === key);
        subtitle = o ? `${o.district} · ${o.address}` : undefined;
      } else if (groupBy === 'day') {
        const dd = dayjs(key);
        const today = dayjs(now).startOf('day');
        title = dd.isSame(today, 'day') ? 'Сегодня' : dd.isSame(today.subtract(1, 'day'), 'day') ? 'Вчера' : dd.format('D MMMM YYYY, dddd');
      } else {
        title = NOTIFICATION_KIND[key as NotificationKind].label;
      }
      return { key, title, subtitle, items, unread: items.filter((n) => !n.read).length, last: items[0] };
    });
    // сначала группы с непрочитанными «требует действия», затем по свежести
    return out.sort((a, b) => {
      const pa = a.items.some((n) => !n.read && n.kind === 'action') ? 1 : 0;
      const pb = b.items.some((n) => !n.read && n.kind === 'action') ? 1 : 0;
      if (groupBy === 'object' && pa !== pb) return pb - pa;
      return b.last.at.localeCompare(a.last.at);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.map((n) => n.id + n.read).join(), groupBy]);

  const pageGroups = groups.slice((page - 1) * PAGE, page * PAGE);

  const markRead = (ids: string[]) => act((d) => {
    const set = new Set(ids);
    d.notifications.forEach((n) => { if (set.has(n.id)) n.read = true; });
  });

  const open = (n: Notification) => {
    markRead([n.id]);
    if (n.link) nav(n.link);
  };

  return (
    <Card
      title={<span>Уведомления {countBy('all') > 0 && <Badge count={countBy('all')} style={{ marginLeft: 6 }} />}</span>}
      extra={filtered.some((n) => !n.read) && (
        <Button icon={<CheckOutlined />} onClick={() => markRead(filtered.filter((n) => !n.read).map((n) => n.id))}>
          Прочитать показанные ({filtered.filter((n) => !n.read).length})
        </Button>
      )}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Segmented
          value={kind}
          onChange={(v) => { setKind(v as any); setPage(1); }}
          options={[
            { value: 'all', label: <span>Все {countBy('all') > 0 && <Badge count={countBy('all')} size="small" />}</span> },
            ...(Object.keys(NOTIFICATION_KIND) as NotificationKind[]).map((k) => ({
              value: k,
              label: <span>{NOTIFICATION_KIND[k].label} {countBy(k) > 0 && <Badge count={countBy(k)} size="small" color={k === 'action' ? '#1677ff' : k === 'important' ? '#eb2f96' : k === 'reminder' ? '#fa8c16' : '#bfbfbf'} />}</span>,
            })),
          ]}
        />
        <Space wrap>
          <Input prefix={<SearchOutlined />} placeholder="Поиск по объекту или тексту" allowClear value={q} style={{ width: 280 }}
            onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select value={period} style={{ width: 150 }} onChange={(v) => { setPeriod(v); setPage(1); }}
            options={[{ value: 0, label: 'За всё время' }, { value: 1, label: 'За сутки' }, { value: 7, label: 'За 7 дней' }, { value: 30, label: 'За 30 дней' }]} />
          <Select value={groupBy} style={{ width: 190 }} onChange={(v) => { setGroupBy(v); setPage(1); }}
            options={[{ value: 'object', label: 'Группировать по объектам' }, { value: 'day', label: 'Группировать по дням' }, { value: 'kind', label: 'Группировать по типу' }]} />
          <Space><Switch checked={unreadOnly} onChange={(v) => { setUnreadOnly(v); setPage(1); }} /> только непрочитанные</Space>
        </Space>

        {groups.length === 0 ? (
          <Empty description={unreadOnly ? 'Непрочитанных уведомлений нет' : 'Уведомлений нет'} />
        ) : (
          <>
            <Typography.Text type="secondary">Групп: {groups.length} · уведомлений: {filtered.length}</Typography.Text>
            <Collapse
              items={pageGroups.map((g) => {
                const kinds = (Object.keys(NOTIFICATION_KIND) as NotificationKind[])
                  .map((k) => ({ k, c: g.items.filter((n) => n.kind === k && !n.read).length }))
                  .filter((x) => x.c > 0);
                const limit = expanded[g.key] || IN_GROUP;
                return {
                  key: g.key,
                  label: (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div>
                          <b style={{ fontWeight: g.unread ? 700 : 500 }}>{g.title}</b>
                          {g.unread > 0 && <Badge count={g.unread} style={{ marginLeft: 8 }} />}
                          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>всего {g.items.length}</Typography.Text>
                        </div>
                        {g.subtitle && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{g.subtitle}</Typography.Text>}
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#595959', fontSize: 13 }}>
                          {g.last.text}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 12, color: '#8c8c8c' }}>{fmtDate(g.last.at)}</div>
                        <Space size={2} style={{ marginTop: 4 }}>
                          {kinds.map((x) => <Tag key={x.k} color={NOTIFICATION_KIND[x.k].color} style={{ fontSize: 11, marginInlineEnd: 0 }}>{NOTIFICATION_KIND[x.k].label}: {x.c}</Tag>)}
                        </Space>
                      </div>
                    </div>
                  ),
                  extra: g.unread > 0 && (
                    <Button size="small" type="link" onClick={(e) => { e.stopPropagation(); markRead(g.items.filter((n) => !n.read).map((n) => n.id)); }}>
                      Прочитать
                    </Button>
                  ),
                  children: (
                    <div>
                      {g.items.slice(0, limit).map((n) => (
                        <div key={n.id} onClick={() => open(n)}
                          style={{ padding: '8px 10px', borderRadius: 6, cursor: 'pointer', marginBottom: 4, background: n.read ? undefined : '#f0f7ff', borderLeft: `3px solid ${n.read ? 'transparent' : '#1677ff'}` }}>
                          <Space size={4} wrap style={{ marginBottom: 2 }}>
                            <Tag color={NOTIFICATION_KIND[n.kind].color} style={{ fontSize: 11 }}>{NOTIFICATION_KIND[n.kind].label}</Tag>
                            {groupBy !== 'object' && objName(n.objectId) && <Tag style={{ fontSize: 11 }}>{objName(n.objectId)}</Tag>}
                            {exName(n.executionId) && <Tag bordered={false} style={{ fontSize: 11 }}>{exName(n.executionId)}</Tag>}
                            {n.telegram && <Tag icon={<SendOutlined />} color="blue" bordered={false} style={{ fontSize: 11 }}>Telegram</Tag>}
                          </Space>
                          <div style={{ fontWeight: n.read ? 400 : 600 }}>{n.text}</div>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{fmtDate(n.at)}</Typography.Text>
                        </div>
                      ))}
                      {g.items.length > limit && (
                        <Button type="link" onClick={() => setExpanded({ ...expanded, [g.key]: limit + 20 })}>
                          Показать ещё ({g.items.length - limit})
                        </Button>
                      )}
                    </div>
                  ),
                };
              })}
            />
            {groups.length > PAGE && (
              <Pagination current={page} pageSize={PAGE} total={groups.length} onChange={setPage} showSizeChanger={false} style={{ textAlign: 'right' }} />
            )}
          </>
        )}
      </Space>
    </Card>
  );
}
