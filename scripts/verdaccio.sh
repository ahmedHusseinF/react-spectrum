#!/bin/bash

port=4000
original_registry=`npm get registry`
registry="http://localhost:$port"
output="output.out"
ci=false
commit_to_revert="HEAD"

if [ "$1" = "ci" ];
then
  ci=true
fi

function cleanup {
  echo "Cleaning up"
  if [ "$ci" = false ];
  then
    lsof -ti tcp:4000 | xargs kill
    # Clean up generated dists if run locally
    rm -rf packages/**/dist
    rm -rf storage/ ~/.config/verdaccio/storage/ $output
    git tag -d $(git tag -l)
    git fetch
    git reset --hard $commit_to_revert
    npm set registry $original_registry
    return
  else
    # lsof doesn't work in circleci
    netstat -tpln | awk -F'[[:space:]/:]+' '$5 == 4000 {print $(NF-2)}' | xargs kill
    return
  fi
}

trap cleanup ERR EXIT

# Generate dists for the packages
yarn parcel build packages/@adobe/react-spectrum/ packages/@react-{spectrum,aria,stately}/*/ packages/@internationalized/*/ --no-optimize --log-level error

# Start verdaccio and send it to the background
yarn verdaccio --listen $port &>${output}&

# Wait for verdaccio to start
grep -q 'http address' <(tail -f $output)

# Login as test user
yarn npm-cli-login -u abc -p abc -e 'abc@abc.com' -r $registry

if [ "$ci" = true ];
then
  git config --global user.email octobot@github.com
  git config --global user.name GitHub Actions
fi

# Bump all package versions (allow publish from current branch but don't push tags or commit)
yarn lerna version minor --force-publish --allow-branch `git branch --show-current` --no-push --yes
commit_to_revert="HEAD~1"

if [ "$ci" = true ];
then
# Get rid of npmrc file generated by install since it will block lerna publish
  git checkout -- .
fi

# Publish packages to verdaccio
yarn lerna publish from-package --registry $registry --yes

npm set registry $registry

if [ "$ci" = true ];
then
  # build prod docs with a public url of /reactspectrum/COMMIT_HASH_BEFORE_PUBLISH/verdaccio/docs
  node scripts/buildWebsite.js /reactspectrum/`git rev-parse HEAD~1`/verdaccio/docs
  cp packages/dev/docs/pages/robots.txt dist/production/docs/robots.txt

  # Rename the dist folder from dist/production/docs to verdaccio_dist/COMMIT_HASH_BEFORE_PUBLISH/verdaccio/docs
  # This is so we can have verdaccio build in a separate stream from deploy and deploy_prod
  verdaccio_path=verdaccio_dist/`git rev-parse HEAD~1`/verdaccio
  mkdir -p $verdaccio_path
  mv dist/production/docs $verdaccio_path

  #install packages in test app
  cd examples/rsp-cra-18
  yarn install

  # Build test app and move to dist folder. Store the size of the build in a text file
  yarn build
  du -c build/ > size.txt
  mkdir -p ../../$verdaccio_path/size
  mv size.txt ../../$verdaccio_path/size
  mv build ../../$verdaccio_path

  cd ../..
else
  # Wait for user input to do cleanup
  read -n 1 -p "Press a key to close server and cleanup"
fi
