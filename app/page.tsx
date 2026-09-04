import { PolicyConsole } from '@/components/policy-console';
import { readPolicyStore } from '@/lib/policies';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const store = await readPolicyStore();
  return (
    <PolicyConsole
      initialStore={store}
      initialRequiresPassword={Boolean(process.env.ADMIN_PASSWORD)}
    />
  );
}
