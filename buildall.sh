#!/bin/bash

#
# This script will check out and build all the latest OpenWebRX+
# packages in the BUILD_DIR folder, placing .deb files into
# OUTPUT_DIR folder.
#

BUILD_DIR=./owrx-build
OUTPUT_DIR=./owrx-output

rm -rf ${BUILD_DIR} ${OUTPUT_DIR}
mkdir ${BUILD_DIR} ${OUTPUT_DIR}
pushd ${BUILD_DIR}

echo "##### Cloning GIT repositories to ${BUILD_DIR} ... #####"
git clone -b master https://github.com/luarvique/csdr.git
git clone -b master https://github.com/luarvique/pycsdr.git
git clone -b master https://github.com/luarvique/owrx_connector.git
git clone -b master https://github.com/luarvique/openwebrx.git
git clone -b master https://github.com/luarvique/SoapySDRPlay3.git
git clone -b master https://github.com/jketterl/codecserver.git
git clone -b master https://github.com/jketterl/digiham.git
git clone -b master https://github.com/jketterl/pydigiham.git
git clone -b master https://github.com/jketterl/js8py.git

echo "##### Building CSDR... #####"
pushd csdr
dpkg-buildpackage -us -uc
popd
# PyCSDR and OWRX-Connector builds depend on the latest CSDR
sudo dpkg -i csdr*.deb libcsdr*.deb nmux*.deb

echo "##### Building PyCSDR... #####"
pushd pycsdr
dpkg-buildpackage -us -uc
popd
# OpenWebRX build depends on the latest PyCSDR
sudo dpkg -i python3-csdr*.deb

echo "##### Building OWRX-Connector... #####"
pushd owrx_connector
dpkg-buildpackage -us -uc
popd
# Not installing OWRX-Connectors here since there are no
# further build steps depending on it
#sudo dpkg -i *connector*.deb

echo "##### Building CodecServer... #####"
pushd codecserver
dpkg-buildpackage -us -uc
popd
# Not installing CodecServer here since there are no
# further build steps depending on it
#sudo dpkg -i *codecserver*.deb

echo "##### Building DigiHAM... #####"
pushd digiham
dpkg-buildpackage -us -uc
popd
# PyDigiHAM build depends on the latest DigiHAM
sudo dpkg -i *digiham*.deb

echo "##### Building PyDigiHAM... #####"
pushd pydigiham
dpkg-buildpackage -us -uc
popd
# Not installing PyDigiHAM here since there are no further
# build steps depending on it
#sudo dpkg -i python3-digiham*.deb

echo "##### Building JS8Py... #####"
pushd js8py
dpkg-buildpackage -us -uc
popd
# Not installing JS8Py here since there are no further
# build steps depending on it
#sudo dpkg -i *js8py*.deb

echo "##### Building OpenWebRX... #####"
pushd openwebrx
dpkg-buildpackage -us -uc
popd
# Not installing OpenWebRX here since there are no further
# build steps depending on it
#sudo dpkg -i openwebrx*.deb

pushd SoapySDRPlay3
# Debian Bullseye uses SoapySDR v0.7
HAVE_SOAPY=`apt-cache search libsoapysdr0.7`
if [ ! -z "${HAVE_SOAPY}" ] ; then
  echo "##### Building SoapySDRPlay3 v0.7 (Debian) ... #####"
  cp debian/control.debian debian/control
  dpkg-buildpackage -us -uc
fi
# Ubuntu Jammy uses SoapySDR v0.8
HAVE_SOAPY=`apt-cache search libsoapysdr0.8`
if [ ! -z "${HAVE_SOAPY}" ] ; then
  echo "##### Building SoapySDRPlay3 v0.8 (Ubuntu) ... #####"
  cp debian/control.ubuntu debian/control
  dpkg-buildpackage -us -uc
fi
popd

echo "##### Moving packages to ${OUTPUT_DIR} ... #####"
popd
mv ${BUILD_DIR}/*.deb ${OUTPUT_DIR}
echo "##### ALL DONE! #####"
