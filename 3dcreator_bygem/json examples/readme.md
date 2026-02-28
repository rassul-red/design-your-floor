how to get image 

idx = random.randrange(len(plans))
plan = plans[idx]
ax = plot_plan(plan, title=f'Plan #{idx}')
plt.show()