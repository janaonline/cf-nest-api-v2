```bash
# run all test
$ npm test

#Ran all test suites matching src/web/afs-digitization.
$ npm test -- src/web/afs-digitization --passWithNoTests 2>&1

# run specific file
$ npm test -- src/web/afs-digitization/afs-digitization.controller.spec.ts --passWithNoTests 2>&1
```

npm test -- --testTimeout=10000 2>&1 | Select-Object -First 250 | Select-Object -Last 100
npm test -- --testTimeout=10000 2>&1 | Select-Object -Last 15
