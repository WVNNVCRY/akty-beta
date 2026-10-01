import { useNavigate } from 'react-router-dom';
import { Card, Col, Empty, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import { AlertOutlined } from '@ant-design/icons';
import { useData } from '../store';
import { DAY, STAGE, actOf, executionBalance, executionStage, fmt, shortage } from '../logic';
import { nowMs } from '../engine';
import { ActsTable } from './Acts';

export default function Dashboard() {
  const data = useData();
  const nav = useNavigate();
  const now = nowMs(data);
  const { remindFirstDays: d1, remindSecondDays: d2 } = data.settings;

  const exRows = data.executions.map((ex) => {
    const stage = executionStage(data, ex);
    const obj = data.objects.find((o) => o.id === ex.objectId)!;
    const idle = Math.floor((now - new Date(ex.lastActivityAt).getTime()) / DAY);
    const forms = data.forms.filter((f) => f.executionId === ex.id);
    const started = forms.length > 0 || !!actOf(data, ex.id);
    const reasons: { label: string; color: string }[] = [];
    if (ex.titleChange) reasons.push({ label: `изменён титул ${fmt(ex.titleChange.from)} → ${fmt(ex.titleChange.to)}`, color: 'magenta' });
    if (forms.some((f) => f.status === 'REJECTED_BY_CLIENT')) reasons.push({ label: 'заказчик отклонил форму', color: 'red' });
    if (forms.some((f) => f.status === 'REJECTED_BY_GC')) reasons.push({ label: 'возвращена ГП', color: 'volcano' });
    if (forms.some((f) => f.status === 'DRAFT' && f.history.some((x) => /после одобрения/.test(x.action)))) reasons.push({ label: 'форма отозвана после одобрения', color: 'purple' });
    return { ex, obj, stage, idle, started, reasons, short: shortage(executionBalance(data, ex)) };
  });
  const attention = exRows.filter((r) => r.reasons.length && !['APPROVED', 'ARCHIVED'].includes(r.stage)).sort((a, b) => b.idle - a.idle);
  const count = (s: string) => exRows.filter((r) => r.stage === s).length;
  const onGc = data.acts.filter((a) => a.status === 'ON_CHECK_GC');

  return (
    <Row gutter={[16, 16]}>
      {[
        ['Объектов', data.objects.length],
        ['Выполнений в работе', exRows.filter((r) => !['APPROVED', 'ARCHIVED'].includes(r.stage)).length],
        ['На проверке заказчика', count('ON_CHECK_CLIENT')],
        ['На проверке ГП', onGc.length],
        ['Согласовано', count('APPROVED')],
        ['В архиве', count('ARCHIVED')],
      ].map(([t, v]) => (
        <Col key={t as string} xs={12} md={8} xl={4}><Card className={`stat-card${t === 'На проверке ГП' && (v as number) > 0 ? ' accent' : ''}`}><Statistic title={t} value={v as number} /></Card></Col>
      ))}
      <Col xs={24}>
        <Card title={<span><AlertOutlined style={{ color: '#d4380d', marginInlineEnd: 8 }} />Требует внимания</span>}
          extra={<Typography.Text type="secondary">изменения титула, отклонения, возвраты, отзыв одобренных форм</Typography.Text>}>
          {attention.length === 0 ? <Empty description="Событий, требующих внимания, нет" /> : (
            <Table
              rowKey={(r) => r.ex.id} size="small" pagination={false} dataSource={attention}
              onRow={(r) => ({ onClick: () => nav(`/objects/${r.obj.id}?ex=${r.ex.id}`), style: { cursor: 'pointer' } })}
              columns={[
                { title: 'Объект', render: (_, r) => <span><b>№ {r.obj.excelRowNumber}. {r.obj.name}</b> · {r.ex.name}</span> },
                { title: 'Округ', render: (_, r) => r.obj.district, width: 70 },
                { title: 'Этап', render: (_, r) => <Tag color={STAGE[r.stage].color}>{STAGE[r.stage].label}</Tag> },
                { title: 'Причина', render: (_, r) => <Space size={[4, 4]} wrap>{r.reasons.map((x) => <Tag key={x.label} color={x.color}>{x.label}</Tag>)}</Space> },
                { title: 'Обновлено', render: (_, r) => `${r.idle} дн. назад`, width: 110 },
                { title: 'Недостача, м²', align: 'right', render: (_, r) => (r.short > 0 ? fmt(r.short) : '—') },
              ]}
            />
          )}
        </Card>
      </Col>
      <Col xs={24} xl={12}>
        <Card title={`Ждут вашей проверки (${onGc.length})`}>
          <ActsTable compact acts={onGc} />
        </Card>
      </Col>
      <Col xs={24} xl={12}>
        <Card title="На проверке у заказчика">
          <ActsTable acts={data.acts.filter((a) => a.status === 'ON_CHECK_CLIENT')} compact />
        </Card>
      </Col>
    </Row>
  );
}
