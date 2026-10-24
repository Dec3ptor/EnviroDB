import { Button, Card, Stack } from '@mantine/core';
import { Link } from 'react-router-dom';
import { EmptyState, PageHeader } from '../components/common';
import { useSettingsReady } from '../hooks/useSettings';
import { featureOn } from '../lib/features';
import { CalendarSheet } from '../components/calendar/CalendarSheet';
import { RoundsList } from '../components/calendar/RoundsList';

// The team's monitoring schedule for the year, laid out like the spreadsheet – and linked to the projects.
export function CalendarPage() {
  const settings = useSettingsReady();
  if (!settings) return null;
  if (!featureOn(settings, 'calendar'))
    return (
      <EmptyState
        title="The monitoring calendar is switched off for the team"
        action={
          <Button component={Link} to="/settings?tab=team" variant="default">
            Settings → Features
          </Button>
        }
      >
        Anyone in the team can switch it on – for everyone – in Settings, under Team. Its rows are kept.
      </EmptyState>
    );
  return (
    <>
      <PageHeader
        title="Monitoring calendar"
        description="The team’s monitoring schedule, like the spreadsheet: a row per job, what’s planned each month, coloured as it’s done this year. Select a month and click Round to record it: sampled, sent to the lab, results back, results sent."
      />
      <Stack gap="sm">
        <RoundsList />
        <Card p="sm">
          <CalendarSheet />
        </Card>
      </Stack>
    </>
  );
}
