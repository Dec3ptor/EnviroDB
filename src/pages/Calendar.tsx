import { Card, Stack } from '@mantine/core';
import { PageHeader } from '../components/common';
import { CalendarSheet } from '../components/calendar/CalendarSheet';
import { RoundsList } from '../components/calendar/RoundsList';

// The team's monitoring schedule for the year, laid out like the spreadsheet – and linked to the projects.
export function CalendarPage() {
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
