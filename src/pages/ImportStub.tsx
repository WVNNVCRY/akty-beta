import { Alert, Button, Card, Upload } from 'antd';
import { UploadOutlined } from '@ant-design/icons';

export default function ImportStub() {
  return (
    <Card title="Импорт Excel">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Импорт появится, когда будет утверждён формат таблицы (открытый вопрос №1)"
        description="Планируется: общий титул и титул под выполнение, поиск объекта по № п/п (excelRowNumber), конфликты (перезаписать / создать новый / пропустить), лог ошибок и журнал загрузок. Пока объекты и выполнения заводятся вручную в разделе «Объекты»."
      />
      <Upload disabled beforeUpload={() => false}>
        <Button icon={<UploadOutlined />} disabled>Загрузить .xlsx</Button>
      </Upload>
    </Card>
  );
}
