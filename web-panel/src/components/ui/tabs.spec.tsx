import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tabs, TabsList, TabsTrigger } from './tabs';

describe('Tabs', () => {
  it('styles the selected trigger through the Radix data-state attribute (Tailwind v3 compatible)', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    const triggerA = screen.getByRole('tab', { name: 'A' });
    const triggerB = screen.getByRole('tab', { name: 'B' });

    expect(triggerA).toHaveAttribute('data-state', 'active');
    expect(triggerA.className).toContain('data-[state=active]:bg-background');

    // `data-active:` is a shadcn v4-only shorthand: Tailwind v3 does not compile it.
    expect(triggerA.className).not.toContain('data-active:');
    expect(triggerB.className).not.toContain('data-active:');
  });
});
