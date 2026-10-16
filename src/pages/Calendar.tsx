import { useState } from 'react';
import { Card, Group, Switch, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { PageHeader } from '../components/common';
import { MonitoringCalendar } from '../components/calendar/MonitoringCalendar';

// The team's year of monitoring at a glance: every project's sampling rounds and reports, month by month.
export function CalendarPage() {
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  return (
    <>
      <PageHeader
        title="Monitoring calendar"
        description="Every project's sampling rounds and reports by month. Click a month to mark it done (once the results are sent or reported), doing or cancelled, add a note or an extra job."
      />
      <Card>
        <Group mb="sm" gap="sm">
          <TextInput leftSection={<IconSearch size={14} />} placeholder="Find a project, client or job number" value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={300} />
          <Switch label="Archived projects too" checked={archived} onChange={(e) => setArchived(e.currentTarget.checked)} />
        </Group>
        <MonitoringCalendar search={search} archived={archived} />
      </Card>
    </>
  );
}
