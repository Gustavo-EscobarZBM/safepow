import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

function Hello() {
  return <div>ok</div>;
}

describe('test harness', () => {
  it('renders react components with jsdom and jest-dom matchers', () => {
    render(<Hello />);
    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});
