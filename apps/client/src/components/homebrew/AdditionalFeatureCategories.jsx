// The `category` values that put an uploaded Item or Magic Item on Manage › Additional features,
// behind a disclosure: shown where someone writes one by hand (the raw XML route) and where they
// look for it afterwards (the Additional features empty state).

import Disclosure from '../Disclosure';
import { ADDITIONAL_FEATURE_CATEGORIES } from './adjustmentCategories';

export default function AdditionalFeatureCategories({ summary = 'Categories that show here' }) {
  return (
    <Disclosure summary={summary} data-testid="additional-feature-categories">
      <ul className="flex flex-wrap gap-2 text-xs">
        {ADDITIONAL_FEATURE_CATEGORIES.map((category) => (
          <li key={category}>
            <code>{category}</code>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}
