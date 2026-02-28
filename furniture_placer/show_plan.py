import pickle, random
import matplotlib.pyplot as plt
from resplan_utils import normalize_keys, plot_plan

MAX_AREA = 80  # only show plans at or below this size (m²)

with open('ResPlan.pkl', 'rb') as f:
    plans = pickle.load(f)

for p in plans:
    normalize_keys(p)

small = [p for p in plans if p.get('area', 0) <= MAX_AREA]
print(f'{len(small)} plans <= {MAX_AREA} m²')

plan = random.choice(small)
plot_plan(plan, title=f'Plan #{plan.get("id")}  |  {plan.get("unitType", "")}  |  {plan.get("area", 0):.1f} m²')
plt.show()
